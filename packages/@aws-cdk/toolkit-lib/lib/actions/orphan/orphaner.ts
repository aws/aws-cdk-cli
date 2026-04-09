import { PATH_METADATA_KEY } from '@aws-cdk/cloud-assembly-api';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import type { Deployments } from '../../api/deployments';
import type { IoHelper } from '../../api/io/private';
import {
  findResourcesByPath,
  hasAnyCdkPathMetadata,
  replaceReferences,
  removeDependsOn,
  walkObject,
  assertSafeDeployResult,
} from './private';

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
      throw new Error(`No resources found under construct path '${constructPaths.join(', ')}' in stack '${stack.stackName}'${hint}`);
    }

    const orphanedResources: OrphanedResource[] = logicalIds.map(id => ({
      logicalId: id,
      resourceType: resources[id].Type ?? 'Unknown',
      cdkPath: resources[id].Metadata?.[PATH_METADATA_KEY] ?? id,
    }));

    return {
      stackName: stack.stackName,
      orphanedResources,
      execute: () => this.execute(stack, logicalIds, currentTemplate, constructPaths),
    };
  }

  private async execute(
    stack: cxapi.CloudFormationStackArtifact,
    logicalIds: string[],
    currentTemplate: any,
    constructPaths: string[],
  ): Promise<OrphanResult> {
    const env = await this.deployments.envs.accessStackForReadOnlyStackOperations(stack);
    const cfn = env.sdk.cloudFormation();

    // Get physical resource IDs (Ref values) — paginated for stacks with >100 resources
    const stackResources = await cfn.listStackResources({ StackName: stack.stackName });
    const physicalIds = new Map<string, string>();
    for (const res of stackResources) {
      if (res.LogicalResourceId && res.PhysicalResourceId) {
        physicalIds.set(res.LogicalResourceId, res.PhysicalResourceId);
      }
    }

    // Build resolved values with Ref values
    const values = new Map<string, ResolvedValues>();
    for (const id of logicalIds) {
      values.set(id, { ref: physicalIds.get(id) ?? id, attrs: {} });
    }

    // Resolve GetAtt values via temporary stack outputs.
    // This is decoupled so it can be replaced with Cloud Control API later.
    const attrValues = await this.resolveGetAttValues(stack, logicalIds, currentTemplate, values);

    // Step 2: Replace all references with literals, remove temp outputs
    const templateStep2 = JSON.parse(JSON.stringify(currentTemplate));
    for (const id of logicalIds) {
      replaceReferences(templateStep2, id, attrValues.get(id)!);
      templateStep2.Resources[id].DeletionPolicy = 'Retain';
      templateStep2.Resources[id].UpdateReplacePolicy = 'Retain';
    }

    await this.ioHelper.defaults.info('Step 2/3: Replacing references with literals...');
    const step2Result = await this.deployments.deployStack({
      stack,
      roleArn: this.roleArn,
      toolkitStackName: this.toolkitStackName,
      deploymentMethod: { method: 'change-set', changeSetName: 'cdk-orphan-step2' },
      overrideTemplate: templateStep2,
      usePreviousParameters: true,
      forceDeployment: true,
    });
    assertSafeDeployResult(step2Result, 'Step 2');

    // Step 3: Remove orphaned resources
    const templateStep3 = JSON.parse(JSON.stringify(templateStep2));
    for (const id of logicalIds) {
      delete templateStep3.Resources[id];
      removeDependsOn(templateStep3, id);
    }

    // CloudFormation requires at least one resource in the template
    if (Object.keys(templateStep3.Resources).length === 0) {
      templateStep3.Resources.CDKOrphanPlaceholder = {
        Type: 'AWS::CloudFormation::WaitConditionHandle',
      };
    }

    await this.ioHelper.defaults.info('Step 3/3: Removing resources from stack...');
    const step3Result = await this.deployments.deployStack({
      stack,
      roleArn: this.roleArn,
      toolkitStackName: this.toolkitStackName,
      deploymentMethod: { method: 'change-set', changeSetName: 'cdk-orphan-step3' },
      overrideTemplate: templateStep3,
      usePreviousParameters: true,
      forceDeployment: true,
    });
    assertSafeDeployResult(step3Result, 'Step 3');
    if (step3Result.noOp) {
      throw new Error(
        'Orphan step 3 was unexpectedly a no-op — the resources were not removed from the stack. ' +
        'If this issue persists, please open an issue at https://github.com/aws/aws-cdk-cli/issues ' +
        'with your stack template attached.',
      );
    }

    const resourceMapping = await this.getResourceIdentifiers(stack, logicalIds, physicalIds, currentTemplate, constructPaths);
    return { resourceMapping };
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
    logicalIds: string[],
    currentTemplate: any,
    refValues: Map<string, ResolvedValues>,
  ): Promise<Map<string, ResolvedValues>> {
    const getAttRefs = this.findGetAttReferences(currentTemplate, logicalIds);

    // If there are no GetAtt references, skip the deploy — just return Ref values
    if (getAttRefs.length === 0) {
      return refValues;
    }

    // Inject temporary outputs and set RETAIN
    const templateStep1 = JSON.parse(JSON.stringify(currentTemplate));
    if (!templateStep1.Outputs) {
      templateStep1.Outputs = {};
    }
    for (const ref of getAttRefs) {
      templateStep1.Outputs[ref.outputKey] = {
        Value: { 'Fn::GetAtt': [ref.logicalId, ref.attr] },
      };
    }
    for (const id of logicalIds) {
      replaceReferences(templateStep1, id, refValues.get(id)!);
      templateStep1.Resources[id].DeletionPolicy = 'Retain';
      templateStep1.Resources[id].UpdateReplacePolicy = 'Retain';
    }

    await this.ioHelper.defaults.info('Step 1/3: Resolving attribute values...');
    const step1Result = await this.deployments.deployStack({
      stack,
      roleArn: this.roleArn,
      toolkitStackName: this.toolkitStackName,
      deploymentMethod: { method: 'change-set', changeSetName: 'cdk-orphan-step1' },
      overrideTemplate: templateStep1,
      usePreviousParameters: true,
      forceDeployment: true,
    });
    assertSafeDeployResult(step1Result, 'Step 1');

    // Read resolved values from stack outputs
    const env = await this.deployments.envs.accessStackForReadOnlyStackOperations(stack);
    const cfn = env.sdk.cloudFormation();
    const stackDesc = await cfn.describeStacks({ StackName: stack.stackName });

    // Build result with both Ref and resolved GetAtt values
    const result = new Map<string, ResolvedValues>();
    for (const [id, rv] of refValues) {
      result.set(id, { ref: rv.ref, attrs: { ...rv.attrs } });
    }

    for (const output of stackDesc.Stacks?.[0]?.Outputs ?? []) {
      if (!output.OutputKey || !output.OutputValue) continue;
      const ref = getAttRefs.find(r => r.outputKey === output.OutputKey);
      if (ref) {
        result.get(ref.logicalId)!.attrs[ref.attr] = output.OutputValue;
      }
    }

    return result;
  }

  private findGetAttReferences(template: any, logicalIds: string[]): { logicalId: string; attr: string; outputKey: string }[] {
    const refs: { logicalId: string; attr: string; outputKey: string }[] = [];
    const seen = new Set<string>();

    walkObject(template, (value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const getAtt = value['Fn::GetAtt'];
        if (Array.isArray(getAtt) && logicalIds.includes(getAtt[0])) {
          const key = `${getAtt[0]}.${getAtt[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            const outputKey = `CdkOrphan${getAtt[0]}${getAtt[1]}`.replace(/[^a-zA-Z0-9]/g, '');
            refs.push({ logicalId: getAtt[0], attr: getAtt[1], outputKey });
          }
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
    constructPaths: string[],
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

        // Only include the primary resource for each construct path
        // e.g. for path "MyTable", match "StackName/MyTable/Resource" exactly
        const cdkPath = resource.Metadata?.[PATH_METADATA_KEY] ?? '';
        const primaryPaths = constructPaths.map(p => `${stack.stackName}/${p}/Resource`);
        if (!primaryPaths.includes(cdkPath)) continue;

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
    } catch {
      await this.ioHelper.defaults.debug('Could not retrieve resource identifier summaries');
    }

    return result;
  }
}
