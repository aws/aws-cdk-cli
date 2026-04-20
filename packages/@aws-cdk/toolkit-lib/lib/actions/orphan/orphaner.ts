import { PATH_METADATA_KEY } from '@aws-cdk/cloud-assembly-api';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import {
  findResourcesByPath,
  hasAnyCdkPathMetadata,
  replaceReferences,
  removeDependsOn,
  walkObject,
  assertDeploySucceeded,
  ensureNonEmptyResources,
} from './private';
import type { ICloudFormationClient } from '../../api/aws-auth/sdk';
import type { Deployments } from '../../api/deployments';
import type { IoHelper } from '../../api/io/private';
import { ToolkitError } from '../../toolkit/toolkit-error';

interface ResolvedValues {
  ref: string;
  attrs: Record<string, string>;
}

export interface ResourceOrphanerProps {
  readonly deployments: Deployments;
  readonly ioHelper: IoHelper;
  readonly roleArn?: string;
  readonly toolkitStackName?: string;
}

/**
 * A resource that will be orphaned.
 */
export interface OrphanedResource {
  readonly logicalId: string;
  readonly resourceType: string;
  readonly cdkPath: string;
}

/**
 * The result of planning an orphan operation.
 */
export interface OrphanPlan {
  /** The stack being modified */
  readonly stackName: string;
  /** Resources that will be detached from the stack */
  readonly orphanedResources: OrphanedResource[];
  /** Execute the orphan operation (3 CloudFormation deployments) */
  execute(): Promise<OrphanResult>;
}

/**
 * The result of executing an orphan operation.
 */
export interface OrphanResult {
  /** Resource mapping JSON for use with `cdk import --resource-mapping` */
  readonly resourceMapping: Record<string, Record<string, string>>;
}

/**
 * Orphans all resources under construct path(s) from a CloudFormation stack.
 *
 * Usage:
 *   const plan = await orphaner.makePlan(stack, constructPaths);
 *   // inspect plan.orphanedResources
 *   const result = await plan.execute();
 */
export class ResourceOrphaner {
  private readonly deployments: Deployments;
  private readonly ioHelper: IoHelper;
  private readonly roleArn?: string;
  private readonly toolkitStackName?: string;

  constructor(props: ResourceOrphanerProps) {
    this.deployments = props.deployments;
    this.ioHelper = props.ioHelper;
    this.roleArn = props.roleArn;
    this.toolkitStackName = props.toolkitStackName;
  }

  /**
   * Analyze the stack and build a plan of what will be orphaned.
   * This is read-only — no changes are made until `plan.execute()` is called.
   */
  public async makePlan(stack: cxapi.CloudFormationStackArtifact, constructPaths: string[]): Promise<OrphanPlan> {
    const currentTemplate = await this.deployments.readCurrentTemplate(stack);
    const resources = currentTemplate.Resources ?? {};

    const logicalIds: string[] = [];
    for (const p of constructPaths) {
      logicalIds.push(...findResourcesByPath(resources, stack.stackName, p));
    }

    if (logicalIds.length === 0) {
      const hint = !hasAnyCdkPathMetadata(resources)
        ? ' (no resources in this stack have aws:cdk:path metadata — was it disabled?)'
        : '';
      throw new ToolkitError('OrphanNoResources', `No resources found under construct path '${constructPaths.join(', ')}' in stack '${stack.stackName}'${hint}`);
    }

    const orphanedResources: OrphanedResource[] = logicalIds.map(id => ({
      logicalId: id,
      resourceType: resources[id].Type ?? 'Unknown',
      cdkPath: resources[id].Metadata?.[PATH_METADATA_KEY] ?? id,
    }));

    return {
      stackName: stack.stackName,
      orphanedResources,
      execute: () => this.execute(stack, logicalIds, currentTemplate),
    };
  }

  private async execute(
    stack: cxapi.CloudFormationStackArtifact,
    logicalIds: string[],
    currentTemplate: any,
  ): Promise<OrphanResult> {
    const env = await this.deployments.envs.accessStackForReadOnlyStackOperations(stack);
    const cfn = env.sdk.cloudFormation();

    // Get physical resource IDs (Ref values)
    const stackResources = await cfn.listStackResources({ StackName: stack.stackName });
    const physicalIds = new Map<string, string>();
    for (const res of stackResources) {
      if (res.LogicalResourceId && res.PhysicalResourceId) {
        physicalIds.set(res.LogicalResourceId, res.PhysicalResourceId);
      }
    }

    // Step 1/3: Resolve GetAtt attribute values via temporary stack outputs
    await this.ioHelper.defaults.info('Step 1/3: Resolving attribute values...');
    const resolvedValues = await this.resolveGetAttValues(stack, cfn, logicalIds, currentTemplate, physicalIds);

    // Step 2/3: Decouple — set RETAIN, replace all Ref/GetAtt with literals, remove DependsOn
    await this.ioHelper.defaults.info('Step 2/3: Decoupling resources...');
    const decoupledTemplate = JSON.parse(JSON.stringify(currentTemplate));
    for (const id of logicalIds) {
      replaceReferences(decoupledTemplate, id, resolvedValues.get(id)!);
      removeDependsOn(decoupledTemplate, id);
      decoupledTemplate.Resources[id].DeletionPolicy = 'Retain';
      decoupledTemplate.Resources[id].UpdateReplacePolicy = 'Retain';
    }
    const step2Result = await this.deployStack(stack, decoupledTemplate, 'cdk-orphan-step2');
    assertDeploySucceeded(step2Result, 'Step 2');

    // Step 3/3: Remove orphaned resources from the template
    await this.ioHelper.defaults.info('Step 3/3: Removing resources from stack...');
    const removalTemplate = JSON.parse(JSON.stringify(decoupledTemplate));
    for (const id of logicalIds) {
      delete removalTemplate.Resources[id];
    }
    ensureNonEmptyResources(removalTemplate);
    const step3Result = await this.deployStack(stack, removalTemplate, 'cdk-orphan-step3');
    assertDeploySucceeded(step3Result, 'Step 3');
    if (step3Result.noOp) {
      throw new ToolkitError(
        'OrphanNoOp',
        'Orphan step 3 was unexpectedly a no-op — the resources were not removed from the stack. ' +
        'If this issue persists, please open an issue at https://github.com/aws/aws-cdk-cli/issues ' +
        'with your stack template attached.',
      );
    }

    const resourceMapping = await this.getResourceIdentifiers(stack, logicalIds, physicalIds, currentTemplate);
    return { resourceMapping };
  }

  /**
   * Deploy a template override to the stack.
   */
  private async deployStack(stack: cxapi.CloudFormationStackArtifact, template: any, changeSetName: string) {
    return this.deployments.deployStack({
      stack,
      roleArn: this.roleArn,
      toolkitStackName: this.toolkitStackName,
      deploymentMethod: { method: 'change-set', changeSetName },
      overrideTemplate: template,
      usePreviousParameters: true,
      forceDeployment: true,
    });
  }

  /**
   * Resolve GetAtt attribute values for orphaned resources.
   *
   * Current strategy: inject temporary Outputs into the stack that reference
   * each GetAtt, deploy, then read the resolved values from DescribeStacks.
   *
   * This function is intentionally decoupled from the rest of the orphan flow
   * so it can be replaced with a Cloud Control API-based approach later.
   *
   * Returns a complete map of resolved values (Ref + attrs) for each logical ID.
   */
  private async resolveGetAttValues(
    stack: cxapi.CloudFormationStackArtifact,
    cfn: ICloudFormationClient,
    logicalIds: string[],
    currentTemplate: any,
    physicalIds: Map<string, string>,
  ): Promise<Map<string, ResolvedValues>> {
    // Build Ref values from physical IDs
    const values = new Map<string, ResolvedValues>();
    for (const id of logicalIds) {
      const physicalId = physicalIds.get(id);
      if (!physicalId) {
        throw new ToolkitError('OrphanMissingPhysicalId', `Could not resolve physical resource ID for '${id}'`);
      }
      values.set(id, { ref: physicalId, attrs: {} });
    }

    const getAttRefs = this.findGetAttReferences(currentTemplate, logicalIds);

    // If there are no GetAtt references, skip the deploy
    if (getAttRefs.size === 0) {
      return values;
    }

    // Inject temporary outputs so CloudFormation resolves the GetAtt values
    const resolveTemplate = JSON.parse(JSON.stringify(currentTemplate));
    if (!resolveTemplate.Outputs) {
      resolveTemplate.Outputs = {};
    }
    for (const [outputKey, ref] of getAttRefs) {
      resolveTemplate.Outputs[outputKey] = {
        Value: { 'Fn::GetAtt': [ref.logicalId, ref.attr] },
      };
    }

    const step1Result = await this.deployStack(stack, resolveTemplate, 'cdk-orphan-step1');
    assertDeploySucceeded(step1Result, 'Step 1');

    // Read resolved values from stack outputs
    const stackDesc = await cfn.describeStacks({ StackName: stack.stackName });
    for (const output of stackDesc.Stacks?.[0]?.Outputs ?? []) {
      if (!output.OutputKey || !output.OutputValue) continue;
      const ref = getAttRefs.get(output.OutputKey);
      if (ref) {
        values.get(ref.logicalId)!.attrs[ref.attr] = output.OutputValue;
      }
    }

    return values;
  }

  private findGetAttReferences(template: any, logicalIds: string[]): Map<string, { logicalId: string; attr: string }> {
    const refs = new Map<string, { logicalId: string; attr: string }>();

    const addRef = (id: string, attr: string) => {
      const outputKey = `CdkOrphan${id}${attr}`.replace(/[^a-zA-Z0-9]/g, '');
      if (!refs.has(outputKey)) {
        refs.set(outputKey, { logicalId: id, attr });
      }
    };

    const scanSubString = (str: string) => {
      // Match ${LogicalId.Attr} patterns in Fn::Sub format strings
      const pattern = /\$\{([^}.]+)\.([^}]+)\}/g;
      let match;
      while ((match = pattern.exec(str)) !== null) {
        const [, id, attr] = match;
        if (logicalIds.includes(id)) {
          addRef(id, attr);
        }
      }
    };

    walkObject(template, (value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Explicit Fn::GetAtt
        const getAtt = value['Fn::GetAtt'];
        if (Array.isArray(getAtt) && logicalIds.includes(getAtt[0])) {
          addRef(getAtt[0], getAtt[1]);
        }

        // Implicit GetAtt inside Fn::Sub
        const sub = value['Fn::Sub'];
        if (typeof sub === 'string') {
          scanSubString(sub);
        } else if (Array.isArray(sub) && typeof sub[0] === 'string') {
          scanSubString(sub[0]);
        }
      }
    });

    return refs;
  }

  private async getResourceIdentifiers(
    stack: cxapi.CloudFormationStackArtifact,
    logicalIds: string[],
    physicalIds: Map<string, string>,
    template: any,
  ): Promise<Record<string, Record<string, string>>> {
    const result: Record<string, Record<string, string>> = {};

    try {
      const summaries = await this.deployments.resourceIdentifierSummaries(stack);

      const identifiersByType = new Map<string, string[]>();
      for (const summary of summaries) {
        if (summary.ResourceType && summary.ResourceIdentifiers) {
          identifiersByType.set(summary.ResourceType, summary.ResourceIdentifiers);
        }
      }

      const resources = template.Resources ?? {};

      for (const id of logicalIds) {
        const resource = resources[id];
        if (!resource) continue;

        const identifierProps = identifiersByType.get(resource.Type);
        if (!identifierProps || identifierProps.length === 0) continue;

        const identifier: Record<string, string> = {};
        const props = resource.Properties ?? {};

        for (const prop of identifierProps) {
          if (props[prop] && typeof props[prop] === 'string') {
            identifier[prop] = props[prop];
          } else if (identifierProps.length === 1 && physicalIds.has(id)) {
            identifier[prop] = physicalIds.get(id)!;
          }
        }

        if (Object.keys(identifier).length > 0) {
          result[id] = identifier;
        }
      }
    } catch (e) {
      await this.ioHelper.defaults.warn(`Could not retrieve resource identifiers for import: ${(e as Error).message}`);
    }

    return result;
  }
}
