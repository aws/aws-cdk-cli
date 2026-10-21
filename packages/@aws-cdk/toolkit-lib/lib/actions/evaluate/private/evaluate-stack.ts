import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import type { SDK } from '../../../api/aws-auth/private';
import type { NestedStackTemplates, SharedLookups, Template } from '../../../api/cloudformation';
import { EvaluateCloudFormationTemplate, evaluateTemplateBestEffort, containsExpression, loadCurrentTemplateWithNestedStacks } from '../../../api/cloudformation';
import { parallelPromises } from '../../../util';
import type { EvaluatedStack } from '../index';

/** Nested stacks of one stack to evaluate at the same time */
const NESTED_STACK_CONCURRENCY = 4;

export interface EvaluateStackProps {
  readonly stackArtifact: CloudFormationStackArtifact;
  /** The deployed stack's parameter values, as DescribeStacks returns them (NoEcho values are masked) */
  readonly parameters: { [name: string]: string };
  /** Lookups shared by all evaluators of the run */
  readonly lookups: SharedLookups;
  readonly stackId: string;
  readonly account: string;
  readonly region: string;
  readonly partition: string;
  readonly sdk: SDK;
  /** Receives warnings, e.g. when the deployed template differs from the one being evaluated */
  readonly warn: (message: string) => Promise<void>;
}

/**
 * Evaluates a deployed stack's template and, recursively, the templates of its CDK-managed nested stacks.
 *
 * A nested stack is evaluated with the parameter values its parent passes, as evaluated in the parent;
 * values the parent could not evaluate are unavailable in the nested stack.
 */
export async function evaluateStackBestEffort(props: EvaluateStackProps): Promise<EvaluatedStack> {
  const { stackArtifact, sdk } = props;
  const currentTemplate = await loadCurrentTemplateWithNestedStacks(stackArtifact, sdk);
  const common = {
    stackArtifact,
    account: props.account,
    region: props.region,
    partition: props.partition,
    sdk,
    // shared by all the stacks' evaluators, so each stack is listed at most once
    stackResourcesByStackName: new Map(),
    lookups: props.lookups,
  };

  async function evaluateStack(
    stackName: string,
    hierarchicalId: string,
    template: Template,
    parameters: { [name: string]: string },
    unavailableParameters: { [name: string]: string },
    stackId: string,
    nestedStacks: { [logicalId: string]: NestedStackTemplates },
  ): Promise<EvaluatedStack> {
    const evaluator = new EvaluateCloudFormationTemplate({
      ...common,
      stackName,
      template,
      // pseudo parameters the evaluator does not provide itself
      parameters: { ...parameters, 'AWS::StackName': stackName, 'AWS::StackId': stackId },
      nestedStacks,
      // CloudFormation semantics: empty strings are values; unavailable parameters never fall back to their Default
      strictValues: true,
      unavailableParameters: Object.keys(unavailableParameters),
    });
    const evaluation = await evaluateTemplateBestEffort(evaluator, template, { unavailableParameters });

    const evaluatedNestedStacks: { [logicalId: string]: EvaluatedStack } = {};
    const evaluateNested = async (logicalId: string, nested: NestedStackTemplates) => {
      const resource = evaluation.template.Resources?.[logicalId];
      if (!nested.physicalName || !resource) {
        return; // not deployed, or not created because of its condition
      }
      await warnOnDrift(nested.physicalName, nested.generatedTemplate, nested.deployedTemplate);
      const nestedParameters: { [name: string]: string } = {};
      const nestedUnavailable: { [name: string]: string } = {};
      for (const [name, value] of Object.entries<any>(resource.Properties?.Parameters ?? {})) {
        if (containsExpression(value)) {
          nestedUnavailable[name] = `the value passed by stack '${stackName}' could not be evaluated`;
        } else {
          nestedParameters[name] = Array.isArray(value) ? value.join(',') : String(value);
        }
      }
      const nestedStackId = await evaluator.evaluateCfnExpression({ Ref: logicalId });
      evaluatedNestedStacks[logicalId] = await evaluateStack(
        nested.physicalName,
        `${hierarchicalId}/${logicalId}`,
        nested.generatedTemplate,
        nestedParameters,
        nestedUnavailable,
        nestedStackId,
        nested.nestedStackTemplates,
      );
    };
    await parallelPromises(NESTED_STACK_CONCURRENCY,
      Object.entries(nestedStacks).map(([logicalId, nested]) => () => evaluateNested(logicalId, nested)));

    // in template order, whichever finished first
    const ordered = Object.fromEntries(Object.keys(nestedStacks)
      .filter((id) => id in evaluatedNestedStacks)
      .map((id) => [id, evaluatedNestedStacks[id]]));
    return {
      stackName,
      hierarchicalId,
      template: evaluation.template,
      unresolved: evaluation.unresolved,
      ...(Object.keys(ordered).length > 0 ? { nestedStacks: ordered } : {}),
    };
  }

  // The template being evaluated should be the one that is deployed. Compare structure rather than text:
  // GetTemplate doesn't always return the template's characters exactly (e.g. non-ASCII punctuation).
  async function warnOnDrift(stackName: string, evaluated: Template, deployed: Template) {
    const types = (t: Template) => Object.entries<any>(t.Resources ?? {}).map(([id, r]) => `${id} (${r?.Type})`);
    const deployedTypes = new Set(types(deployed));
    const evaluatedTypes = new Set(types(evaluated));
    const onlyEvaluated = [...evaluatedTypes].filter((x) => !deployedTypes.has(x));
    const onlyDeployed = [...deployedTypes].filter((x) => !evaluatedTypes.has(x));
    if (onlyEvaluated.length || onlyDeployed.length) {
      await props.warn(`The template of stack '${stackName}' differs from its deployed template, so evaluated values may not match ` +
        `the deployment. Not deployed: ${onlyEvaluated.join(', ') || 'none'}. Only in the deployed template: ${onlyDeployed.join(', ') || 'none'}`);
    }
  }
  await warnOnDrift(stackArtifact.stackName, stackArtifact.template, currentTemplate.deployedRootTemplate);

  // NoEcho values come back masked; expressions that use them are reported as unresolved instead. A parameter
  // counts as NoEcho if either the evaluated or the deployed template says so.
  const noEcho = new Set([stackArtifact.template, currentTemplate.deployedRootTemplate]
    .flatMap((t) => Object.entries<any>(t.Parameters ?? {}).filter(([, p]) => String(p?.NoEcho).toLowerCase() === 'true').map(([name]) => name)));
  const unavailableParameters = Object.fromEntries([...noEcho].map((name) => [name, 'NoEcho parameter, whose deployed value can\'t be read']));
  const parameters = Object.fromEntries(Object.entries(props.parameters).filter(([name]) => !noEcho.has(name)));

  return evaluateStack(
    stackArtifact.stackName,
    stackArtifact.hierarchicalId,
    stackArtifact.template,
    parameters,
    unavailableParameters,
    props.stackId,
    currentTemplate.nestedStacks,
  );
}
