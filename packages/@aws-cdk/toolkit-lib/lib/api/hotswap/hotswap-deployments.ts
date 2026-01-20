import { format } from 'util';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import * as cfn_diff from '@aws-cdk/cloudformation-diff';
import type { WaiterResult } from '@smithy/util-waiter';
import * as chalk from 'chalk';
import type { AffectedResource, HotswapResult, ResourceSubject, ResourceChange, NonHotswappableChange } from '../../payloads';
import { NonHotswappableReason } from '../../payloads';
import { formatErrorMessage } from '../../util';
import type { SDK, SdkProvider } from '../aws-auth/private';
import type { CloudFormationStack, NestedStackTemplates } from '../cloudformation';
import { loadCurrentTemplateWithNestedStacks, EvaluateCloudFormationTemplate } from '../cloudformation';
import { isHotswappableAppSyncChange } from './appsync-mapping-templates';
import { isHotswappableBedrockAgentCoreRuntimeChange } from './bedrock-agentcore-runtimes';
import { isHotswappableCodeBuildProjectChange } from './code-build-projects';
import type {
  HotswapChange,
  HotswapOperation,
  RejectedChange,
  HotswapPropertyOverrides,
} from './common';
import {
  ICON,
  nonHotswappableResource,
} from './common';
import { isHotswappableEcsServiceChange } from './ecs-services';
import { isHotswappableLambdaFunctionChange } from './lambda-functions';
import {
  skipChangeForS3DeployCustomResourcePolicy,
  isHotswappableS3BucketDeploymentChange,
} from './s3-bucket-deployments';
import { isHotswappableStateMachineChange } from './stepfunctions-state-machines';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { SuccessfulDeployStackResult } from '../deployments';
import { IO, SPAN } from '../io/private';
import type { IMessageSpan, IoHelper } from '../io/private';
import { Mode } from '../plugin';

// Must use a require() otherwise esbuild complains about calling a namespace
// eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/consistent-type-imports
const pLimit: typeof import('p-limit') = require('p-limit');

type HotswapDetector = (
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  hotswapPropertyOverrides: HotswapPropertyOverrides,
) => Promise<HotswapChange[]>;

type HotswapMode = 'hotswap-only' | 'fall-back';

const RESOURCE_DETECTORS: { [key: string]: HotswapDetector } = {
  // Lambda
  'AWS::Lambda::Function': isHotswappableLambdaFunctionChange,
  'AWS::Lambda::Version': isHotswappableLambdaFunctionChange,
  'AWS::Lambda::Alias': isHotswappableLambdaFunctionChange,

  // AppSync
  'AWS::AppSync::Resolver': isHotswappableAppSyncChange,
  'AWS::AppSync::FunctionConfiguration': isHotswappableAppSyncChange,
  'AWS::AppSync::GraphQLSchema': isHotswappableAppSyncChange,
  'AWS::AppSync::ApiKey': isHotswappableAppSyncChange,

  'AWS::BedrockAgentCore::Runtime': isHotswappableBedrockAgentCoreRuntimeChange,
  'AWS::ECS::TaskDefinition': isHotswappableEcsServiceChange,
  'AWS::CodeBuild::Project': isHotswappableCodeBuildProjectChange,
  'AWS::StepFunctions::StateMachine': isHotswappableStateMachineChange,
  'Custom::CDKBucketDeployment': isHotswappableS3BucketDeploymentChange,
  'AWS::IAM::Policy': async (
    logicalId: string,
    change: ResourceChange,
    evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  ): Promise<HotswapChange[]> => {
    // If the policy is for a S3BucketDeploymentChange, we can ignore the change
    if (await skipChangeForS3DeployCustomResourcePolicy(logicalId, change, evaluateCfnTemplate)) {
      return [];
    }

    return [nonHotswappableResource(change)];
  },

  'AWS::CDK::Metadata': async () => [],
};

/**
 * Perform a hotswap deployment, short-circuiting CloudFormation if possible.
 * If it's not possible to short-circuit the deployment
 * (because the CDK Stack contains changes that cannot be deployed without CloudFormation),
 * returns `undefined`.
 */
export async function tryHotswapDeployment(
  sdkProvider: SdkProvider,
  ioHelper: IoHelper,
  assetParams: { [key: string]: string },
  cloudFormationStack: CloudFormationStack,
  stackArtifact: cxapi.CloudFormationStackArtifact,
  hotswapMode: HotswapMode,
  hotswapPropertyOverrides: HotswapPropertyOverrides,
): Promise<SuccessfulDeployStackResult | undefined> {
  const hotswapSpan = await ioHelper.span(SPAN.HOTSWAP).begin({
    stack: stackArtifact,
    mode: hotswapMode,
  });

  const result = await hotswapDeployment(
    sdkProvider,
    hotswapSpan,
    assetParams,
    stackArtifact,
    hotswapMode,
    hotswapPropertyOverrides,
  );

  await hotswapSpan.end(result);

  if (result?.hotswapped === true) {
    return {
      type: 'did-deploy-stack',
      noOp: result.hotswappableChanges.length === 0,
      stackArn: cloudFormationStack.stackId,
      outputs: cloudFormationStack.outputs,
    };
  }

  return undefined;
}

/**
 * Perform a hotswap deployment, short-circuiting CloudFormation if possible.
 * Returns information about the attempted hotswap deployment
 */
async function hotswapDeployment(
  sdkProvider: SdkProvider,
  ioSpan: IMessageSpan<any>,
  assetParams: { [key: string]: string },
  stack: cxapi.CloudFormationStackArtifact,
  hotswapMode: HotswapMode,
  hotswapPropertyOverrides: HotswapPropertyOverrides,
): Promise<Omit<HotswapResult, 'duration'>> {
  // resolve the environment, so we can substitute things like AWS::Region in CFN expressions
  const resolvedEnv = await sdkProvider.resolveEnvironment(stack.environment);
  // create a new SDK using the CLI credentials, because the default one will not work for new-style synthesis -
  // it assumes the bootstrap deploy Role, which doesn't have permissions to update Lambda functions
  const sdk = (await sdkProvider.forEnvironment(resolvedEnv, Mode.ForWriting)).sdk;

  const currentTemplate = await loadCurrentTemplateWithNestedStacks(stack, sdk);

  const evaluateCfnTemplate = new EvaluateCloudFormationTemplate({
    stackArtifact: stack,
    parameters: assetParams,
    account: resolvedEnv.account,
    region: resolvedEnv.region,
    partition: (await sdk.currentAccount()).partition,
    sdk,
    nestedStacks: currentTemplate.nestedStacks,
  });

  const stackChanges = cfn_diff.fullDiff(currentTemplate.deployedRootTemplate, stack.template);
  const { hotswappable, nonHotswappable } = await classifyResourceChanges(
    stackChanges,
    evaluateCfnTemplate,
    sdk,
    currentTemplate.nestedStacks, hotswapPropertyOverrides,
  );

  await logRejectedChanges(ioSpan, nonHotswappable, hotswapMode);

  const hotswappableChanges = hotswappable.map(o => o.change);
  const nonHotswappableChanges = nonHotswappable.map(n => n.change);

  await ioSpan.notify(IO.CDK_TOOLKIT_I5401.msg('Hotswap plan created', {
    stack,
    mode: hotswapMode,
    hotswappableChanges,
    nonHotswappableChanges,
  }));

  // preserve classic hotswap behavior
  if (hotswapMode === 'fall-back') {
    if (nonHotswappableChanges.length > 0) {
      return {
        stack,
        mode: hotswapMode,
        hotswapped: false,
        hotswappableChanges,
        nonHotswappableChanges,
      };
    }
  }

  // apply the short-circuitable changes
  await applyAllHotswapOperations(sdk, ioSpan, hotswappable);

  return {
    stack,
    mode: hotswapMode,
    hotswapped: true,
    hotswappableChanges,
    nonHotswappableChanges,
  };
}

interface ClassifiedChanges {
  hotswappable: HotswapOperation[];
  nonHotswappable: RejectedChange[];
}

/**
 * Classifies all changes to all resources as either hotswappable or not.
 * Metadata changes are excluded from the list of (non)hotswappable resources.
 */
async function classifyResourceChanges(
  stackChanges: cfn_diff.TemplateDiff,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  sdk: SDK,
  nestedStackNames: { [nestedStackName: string]: NestedStackTemplates },
  hotswapPropertyOverrides: HotswapPropertyOverrides,
): Promise<ClassifiedChanges> {
  const resourceDifferences = getStackResourceDifferences(stackChanges);

  const promises: Array<() => Promise<HotswapChange[]>> = [];
  const hotswappableResources = new Array<HotswapOperation>();
  const nonHotswappableResources = new Array<RejectedChange>();
  for (const logicalId of Object.keys(stackChanges.outputs.changes)) {
    nonHotswappableResources.push({
      hotswappable: false,
      change: {
        reason: NonHotswappableReason.OUTPUT,
        description: 'output was changed',
        subject: {
          type: 'Output',
          logicalId,
          metadata: evaluateCfnTemplate.metadataFor(logicalId),
        },
      },
    });
  }
  // gather the results of the detector functions
  for (const [logicalId, change] of Object.entries(resourceDifferences)) {
    if (change.newValue?.Type === 'AWS::CloudFormation::Stack' && change.oldValue?.Type === 'AWS::CloudFormation::Stack') {
      const nestedHotswappableResources = await findNestedHotswappableChanges(
        logicalId,
        change,
        nestedStackNames,
        evaluateCfnTemplate,
        sdk,
        hotswapPropertyOverrides,
      );
      hotswappableResources.push(...nestedHotswappableResources.hotswappable);
      nonHotswappableResources.push(...nestedHotswappableResources.nonHotswappable);

      continue;
    }

    const hotswappableChangeCandidate = isCandidateForHotswapping(logicalId, change, evaluateCfnTemplate);
    // we don't need to run this through the detector functions, we can already judge this
    if ('hotswappable' in hotswappableChangeCandidate) {
      if (!hotswappableChangeCandidate.hotswappable) {
        nonHotswappableResources.push(hotswappableChangeCandidate);
      }

      continue;
    }

    const resourceType: string = hotswappableChangeCandidate.newValue.Type;
    if (resourceType in RESOURCE_DETECTORS) {
      // run detector functions lazily to prevent unhandled promise rejections
      promises.push(() =>
        RESOURCE_DETECTORS[resourceType](logicalId, hotswappableChangeCandidate, evaluateCfnTemplate, hotswapPropertyOverrides),
      );
    } else {
      nonHotswappableResources.push(nonHotswappableResource(hotswappableChangeCandidate));
    }
  }

  // resolve all detector results
  const changesDetectionResults: Array<HotswapChange[]> = [];
  for (const detectorResultPromises of promises) {
    // Constant set of promises per resource
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const hotswapDetectionResults = await Promise.all(await detectorResultPromises());
    changesDetectionResults.push(hotswapDetectionResults);
  }

  for (const resourceDetectionResults of changesDetectionResults) {
    for (const propertyResult of resourceDetectionResults) {
      propertyResult.hotswappable
        ? hotswappableResources.push(propertyResult)
        : nonHotswappableResources.push(propertyResult);
    }
  }

  return {
    hotswappable: hotswappableResources,
    nonHotswappable: nonHotswappableResources,
  };
}

/**
 * Returns all changes to resources in the given Stack.
 *
 * @param stackChanges - the collection of all changes to a given Stack
 */
function getStackResourceDifferences(stackChanges: cfn_diff.TemplateDiff): {
  [logicalId: string]: cfn_diff.ResourceDifference;
} {
  // we need to collapse logical ID rename changes into one change,
  // as they are represented in stackChanges as a pair of two changes: one addition and one removal
  const allResourceChanges: { [logId: string]: cfn_diff.ResourceDifference } = stackChanges.resources.changes;
  const allRemovalChanges = filterDict(allResourceChanges, (resChange) => resChange.isRemoval);
  const allNonRemovalChanges = filterDict(allResourceChanges, (resChange) => !resChange.isRemoval);
  for (const [logId, nonRemovalChange] of Object.entries(allNonRemovalChanges)) {
    if (nonRemovalChange.isAddition) {
      const addChange = nonRemovalChange;
      // search for an identical removal change
      const identicalRemovalChange = Object.entries(allRemovalChanges).find(([_, remChange]) => {
        return changesAreForSameResource(remChange, addChange);
      });
      // if we found one, then this means this is a rename change
      if (identicalRemovalChange) {
        const [removedLogId, removedResourceChange] = identicalRemovalChange;
        allNonRemovalChanges[logId] = makeRenameDifference(removedResourceChange, addChange);
        // delete the removal change that forms the rename pair
        delete allRemovalChanges[removedLogId];
      }
    }
  }
  // the final result are all of the remaining removal changes,
  // plus all of the non-removal changes
  // (we saved the rename changes in that object already)
  return {
    ...allRemovalChanges,
    ...allNonRemovalChanges,
  };
}

/** Filters an object with string keys based on whether the callback returns 'true' for the given value in the object. */
function filterDict<T>(dict: { [key: string]: T }, func: (t: T) => boolean): { [key: string]: T } {
  return Object.entries(dict).reduce(
    (acc, [key, t]) => {
      if (func(t)) {
        acc[key] = t;
      }
      return acc;
    },
    {} as { [key: string]: T },
  );
}

/** Finds any hotswappable changes in all nested stacks. */
async function findNestedHotswappableChanges(
  logicalId: string,
  change: cfn_diff.ResourceDifference,
  nestedStackTemplates: { [nestedStackName: string]: NestedStackTemplates },
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  sdk: SDK,
  hotswapPropertyOverrides: HotswapPropertyOverrides,
): Promise<ClassifiedChanges> {
  const nestedStack = nestedStackTemplates[logicalId];
  if (!nestedStack.physicalName) {
    return {
      hotswappable: [],
      nonHotswappable: [
        {
          hotswappable: false,
          change: {
            reason: NonHotswappableReason.NESTED_STACK_CREATION,
            description: 'newly created nested stacks cannot be hotswapped',
            subject: {
              type: 'Resource',
              logicalId,
              resourceType: 'AWS::CloudFormation::Stack',
              metadata: evaluateCfnTemplate.metadataFor(logicalId),
            },
          },
        },
      ],
    };
  }

  const evaluateNestedCfnTemplate = await evaluateCfnTemplate.createNestedEvaluateCloudFormationTemplate(
    nestedStack.physicalName,
    nestedStack.generatedTemplate,
    change.newValue?.Properties?.Parameters,
  );

  const nestedDiff = cfn_diff.fullDiff(
    nestedStackTemplates[logicalId].deployedTemplate,
    nestedStackTemplates[logicalId].generatedTemplate,
  );

  return classifyResourceChanges(
    nestedDiff,
    evaluateNestedCfnTemplate,
    sdk,
    nestedStackTemplates[logicalId].nestedStackTemplates,
    hotswapPropertyOverrides,
  );
}

/** Returns 'true' if a pair of changes is for the same resource. */
function changesAreForSameResource(
  oldChange: cfn_diff.ResourceDifference,
  newChange: cfn_diff.ResourceDifference,
): boolean {
  return (
    oldChange.oldResourceType === newChange.newResourceType &&
    // this isn't great, but I don't want to bring in something like underscore just for this comparison
    JSON.stringify(oldChange.oldProperties) === JSON.stringify(newChange.newProperties)
  );
}

function makeRenameDifference(
  remChange: cfn_diff.ResourceDifference,
  addChange: cfn_diff.ResourceDifference,
): cfn_diff.ResourceDifference {
  return new cfn_diff.ResourceDifference(
    // we have to fill in the old value, because otherwise this will be classified as a non-hotswappable change
    remChange.oldValue,
    addChange.newValue,
    {
      resourceType: {
        oldType: remChange.oldResourceType,
        newType: addChange.newResourceType,
      },
      propertyDiffs: (addChange as any).propertyDiffs,
      otherDiffs: (addChange as any).otherDiffs,
    },
  );
}

/**
 * Returns a `HotswappableChangeCandidate` if the change is hotswappable
 * Returns an empty `HotswappableChange` if the change is to CDK::Metadata
 * Returns a `NonHotswappableChange` if the change is not hotswappable
 */
function isCandidateForHotswapping(
  logicalId: string,
  change: cfn_diff.ResourceDifference,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): RejectedChange | ResourceChange {
  // a resource has been removed OR a resource has been added; we can't short-circuit that change
  if (!change.oldValue) {
    return {
      hotswappable: false,
      change: {
        reason: NonHotswappableReason.RESOURCE_CREATION,
        description: `resource '${logicalId}' was created by this deployment`,
        subject: {
          type: 'Resource',
          logicalId,
          resourceType: change.newValue!.Type,
          metadata: evaluateCfnTemplate.metadataFor(logicalId),
        },
      },
    };
  } else if (!change.newValue) {
    return {
      hotswappable: false,
      logicalId,
      change: {
        reason: NonHotswappableReason.RESOURCE_DELETION,
        description: `resource '${logicalId}' was destroyed by this deployment`,
        subject: {
          type: 'Resource',
          logicalId,
          resourceType: change.oldValue.Type,
          metadata: evaluateCfnTemplate.metadataFor(logicalId),
        },
      },
    };
  }

  // a resource has had its type changed
  if (change.newValue.Type !== change.oldValue.Type) {
    return {
      hotswappable: false,
      change: {
        reason: NonHotswappableReason.RESOURCE_TYPE_CHANGED,
        description: `resource '${logicalId}' had its type changed from '${change.oldValue?.Type}' to '${change.newValue?.Type}'`,
        subject: {
          type: 'Resource',
          logicalId,
          resourceType: change.newValue.Type,
          metadata: evaluateCfnTemplate.metadataFor(logicalId),
        },
      },
    };
  }

  return {
    logicalId,
    oldValue: change.oldValue,
    newValue: change.newValue,
    propertyUpdates: change.propertyUpdates,
    metadata: evaluateCfnTemplate.metadataFor(logicalId),
  };
}

async function applyAllHotswapOperations(sdk: SDK, ioSpan: IMessageSpan<any>, hotswappableChanges: HotswapOperation[]): Promise<void[]> {
  if (hotswappableChanges.length === 0) {
    return Promise.resolve([]);
  }

  await ioSpan.defaults.info(`\n${ICON} hotswapping resources:`);
  const limit = pLimit(10);
  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  return Promise.all(hotswappableChanges.map(hotswapOperation => limit(() => {
    return applyHotswapOperation(sdk, ioSpan, hotswapOperation);
  })));
}

async function applyHotswapOperation(sdk: SDK, ioSpan: IMessageSpan<any>, hotswapOperation: HotswapOperation): Promise<void> {
  // note the type of service that was successfully hotswapped in the User-Agent
  const customUserAgent = `cdk-hotswap/success-${hotswapOperation.service}`;
  sdk.appendCustomUserAgent(customUserAgent);
  const resourceText = (r: AffectedResource) => r.description ?? `${r.resourceType} '${r.physicalName ?? r.logicalId}'`;

  await ioSpan.notify(IO.CDK_TOOLKIT_I5402.msg(
    hotswapOperation.change.resources.map(r => format(`   ${ICON} %s`, chalk.bold(resourceText(r)))).join('\n'),
    hotswapOperation.change,
  ));

  // if the SDK call fails, an error will be thrown by the SDK
  // and will prevent the green 'hotswapped!' text from being displayed
  try {
    await hotswapOperation.apply(sdk);
  } catch (e: any) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      const result: WaiterResult = JSON.parse(formatErrorMessage(e));
      const error = new ToolkitError(formatWaiterErrorResult(result));
      error.name = e.name;
      throw error;
    }
    throw e;
  }

  await ioSpan.notify(IO.CDK_TOOLKIT_I5403.msg(
    hotswapOperation.change.resources.map(r => format(`   ${ICON} %s %s`, chalk.bold(resourceText(r)), chalk.green('hotswapped!'))).join('\n'),
    hotswapOperation.change,
  ));

  sdk.removeCustomUserAgent(customUserAgent);
}

function formatWaiterErrorResult(result: WaiterResult) {
  const main = [
    `Resource is not in the expected state due to waiter status: ${result.state}`,
    result.reason ? `${result.reason}.` : '',
  ].join('. ');

  if (result.observedResponses != null) {
    const observedResponses = Object
      .entries(result.observedResponses)
      .map(([msg, count]) => `  - ${msg} (${count})`)
      .join('\n');

    return `${main} Observed responses:\n${observedResponses}`;
  }

  return main;
}

async function logRejectedChanges(
  ioSpan: IMessageSpan<any>,
  rejectedChanges: RejectedChange[],
  hotswapMode: HotswapMode,
): Promise<void> {
  if (rejectedChanges.length === 0) {
    return;
  }
  /**
   * EKS Services can have a task definition that doesn't refer to the task definition being updated.
   * We have to log this as a non-hotswappable change to the task definition, but when we do,
   * we wind up hotswapping the task definition and logging it as a non-hotswappable change.
   *
   * This logic prevents us from logging that change as non-hotswappable when we hotswap it.
   */
  if (hotswapMode === 'hotswap-only') {
    rejectedChanges = rejectedChanges.filter((change) => change.hotswapOnlyVisible === true);

    if (rejectedChanges.length === 0) {
      return;
    }
  }

  const messages = ['']; // start with empty line

  if (hotswapMode === 'hotswap-only') {
    messages.push(format('%s %s', chalk.red('⚠️'), chalk.red('The following non-hotswappable changes were found. To reconcile these using CloudFormation, specify --hotswap-fallback')));
  } else {
    messages.push(format('%s %s', chalk.red('⚠️'), chalk.red('The following non-hotswappable changes were found:')));
  }

  for (const { change } of rejectedChanges) {
    messages.push('    ' + nonHotswappableChangeMessage(change));
  }
  messages.push(''); // newline

  await ioSpan.defaults.info(messages.join('\n'));
}

/**
 * Formats a NonHotswappableChange
 */
function nonHotswappableChangeMessage(change: NonHotswappableChange): string {
  const subject = change.subject;
  const reason = change.description ?? change.reason;

  switch (subject.type) {
    case 'Output':
      return format(
        'output: %s, reason: %s',
        chalk.bold(subject.logicalId),
        chalk.red(reason),
      );
    case 'Resource':
      return nonHotswappableResourceMessage(subject, reason);
  }
}

/**
 * Formats a non-hotswappable resource subject
 */
function nonHotswappableResourceMessage(subject: ResourceSubject, reason: string): string {
  if (subject.rejectedProperties?.length) {
    return format(
      'resource: %s, type: %s, rejected changes: %s, reason: %s',
      chalk.bold(subject.logicalId),
      chalk.bold(subject.resourceType),
      chalk.bold(subject.rejectedProperties),
      chalk.red(reason),
    );
  }

  return format(
    'resource: %s, type: %s, reason: %s',
    chalk.bold(subject.logicalId),
    chalk.bold(subject.resourceType),
    chalk.red(reason),
  );
}
