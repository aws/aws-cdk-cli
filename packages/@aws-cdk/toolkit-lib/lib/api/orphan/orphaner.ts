import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import type { Deployments } from '../deployments';
import type { IoHelper } from '../io/private';

export interface OrphanResourceOptions {
  /**
   * The stack to operate on.
   */
  readonly stack: cxapi.CloudFormationStackArtifact;

  /**
   * Construct path prefix(es). All resources whose `aws:cdk:path` metadata
   * starts with `<StackName>/<path>/` will be orphaned together.
   * Pass multiple paths to include related infrastructure.
   */
  readonly constructPath: string | string[];

  /**
   * Role ARN to assume for deployments.
   */
  readonly roleArn?: string;

  /**
   * Toolkit stack name.
   */
  readonly toolkitStackName?: string;
}

export interface ResourceOrphanerProps {
  readonly deployments: Deployments;
  readonly ioHelper: IoHelper;
}

/**
 * Orphans all resources under a construct path from a CloudFormation stack.
 *
 * 1. Finds all resources whose aws:cdk:path matches the construct path
 * 2. Resolves all {Ref}/{Fn::GetAtt} references to those resources with literal values
 * 3. Sets DeletionPolicy to Retain on all matched resources
 * 4. Deploys the modified template
 * 5. Removes the matched resources from the template
 * 6. Deploys again (resources are orphaned, not deleted)
 */
export class ResourceOrphaner {
  private readonly deployments: Deployments;
  private readonly ioHelper: IoHelper;

  constructor(props: ResourceOrphanerProps) {
    this.deployments = props.deployments;
    this.ioHelper = props.ioHelper;
  }

  public async orphan(options: OrphanResourceOptions): Promise<void> {
    const { stack, constructPath } = options;

    const currentTemplate = await this.deployments.readCurrentTemplate(stack);
    const resources = currentTemplate.Resources ?? {};

    // 2. Find all resources under the construct path(s)
    const paths = Array.isArray(constructPath) ? constructPath : [constructPath];
    const logicalIds: string[] = [];
    for (const p of paths) {
      logicalIds.push(...this.findResourcesByPath(resources, stack.stackName, p));
    }

    if (logicalIds.length === 0) {
      throw new Error(`No resources found under construct path '${paths.join(', ')}' in stack '${stack.stackName}'`);
    }

    await this.ioHelper.defaults.info(`Found ${logicalIds.length} resource(s) to orphan: ${logicalIds.join(', ')}`);

    // 4. Identify the primary resource (the one with the shortest path — typically the main resource)
    const primaryId = this.findPrimaryResource(logicalIds, resources);
    const physicalName = this.extractPhysicalName(resources[primaryId]);

    // 4. Prepare step 1 template: set RETAIN, replace Ref with physical IDs,
    //    and inject temporary Outputs for each GetAtt so CloudFormation resolves them.
    const templateStep1 = JSON.parse(JSON.stringify(currentTemplate));

    const { values, tempOutputKeys } = await this.resolveAllValues(stack, logicalIds, currentTemplate, templateStep1);

    // Replace Ref values now (we have them from DescribeStackResources)
    for (const id of logicalIds) {
      const v = values.get(id);
      if (v) {
        this.replaceReferences(templateStep1, id, v);
      }
      templateStep1.Resources[id].DeletionPolicy = 'Retain';
      templateStep1.Resources[id].UpdateReplacePolicy = 'Retain';
    }

    // 5. Deploy step 1 (sets RETAIN, replaces Refs with literals, adds temp outputs for GetAtts)
    await this.ioHelper.defaults.info('Step 1/3: Setting RETAIN and resolving Ref values...');
    const step1Result = await this.deployments.deployStack({
      stack,
      roleArn: options.roleArn,
      toolkitStackName: options.toolkitStackName,
      deploymentMethod: { method: 'change-set', changeSetName: 'cdk-orphan-step1' },
      overrideTemplate: templateStep1,
      usePreviousParameters: true,
      forceDeployment: true,
    });
    if (step1Result.type !== 'did-deploy-stack') {
      throw new Error(`Step 1 failed: unexpected result type '${step1Result.type}'`);
    }

    // 6. Read the resolved GetAtt values from the temporary outputs
    await this.readResolvedGetAttValues(stack, logicalIds, currentTemplate, values);

    // 7. Prepare step 2 template: replace GetAtts with resolved literals
    const templateStep2 = JSON.parse(JSON.stringify(templateStep1));
    for (const id of logicalIds) {
      const v = values.get(id);
      if (v) {
        this.replaceReferences(templateStep2, id, v);
      }
    }
    // Remove temporary outputs
    for (const key of tempOutputKeys) {
      delete templateStep2.Outputs?.[key];
    }

    // Deploy step 2 (replaces GetAtts with literals)
    await this.ioHelper.defaults.info('Step 2/3: Resolving GetAtt values...');
    await this.deployments.deployStack({
      stack,
      roleArn: options.roleArn,
      toolkitStackName: options.toolkitStackName,
      deploymentMethod: { method: 'change-set', changeSetName: 'cdk-orphan-step2' },
      overrideTemplate: templateStep2,
      usePreviousParameters: true,
      forceDeployment: true,
    });

    // 8. Remove all orphaned resources
    const templateStep3 = JSON.parse(JSON.stringify(templateStep2));
    for (const id of logicalIds) {
      delete templateStep3.Resources[id];
      this.removeDependsOn(templateStep3, id);
    }

    // 9. Deploy step 3 (resources are orphaned)
    await this.ioHelper.defaults.info('Step 3/3: Removing resources from stack...');
    const step3Result = await this.deployments.deployStack({
      stack,
      roleArn: options.roleArn,
      toolkitStackName: options.toolkitStackName,
      deploymentMethod: { method: 'change-set', changeSetName: 'cdk-orphan-step3' },
      overrideTemplate: templateStep3,
      usePreviousParameters: true,
      forceDeployment: true,
    });
    if (step3Result.type !== 'did-deploy-stack') {
      throw new Error(`Step 3 failed: unexpected result type '${step3Result.type}'`);
    }
    if (step3Result.noOp) {
      const blockers = this.findBlockingResources(templateStep3, logicalIds, templateStep2);
      throw new Error(
        'Step 3 was a no-op — resources were not removed from the stack. ' +
        'Other resources still reference the orphaned resources' +
        (blockers.length > 0
          ? `: ${blockers.join(', ')}. Include them with additional --path flags.`
          : '. Check the deployed template for remaining {Ref} or {Fn::GetAtt} references.'),
      );
    }

    // 8. Output next steps
    const identifier = primaryId && physicalName ? this.extractResourceIdentifier(resources[primaryId]) : undefined;
    const mappingJson = identifier ? JSON.stringify({ [primaryId]: identifier }) : undefined;

    await this.ioHelper.defaults.info(`✅ Construct '${constructPath}' orphaned from ${stack.stackName}`);
    await this.ioHelper.defaults.info('');
    if (physicalName) {
      await this.ioHelper.defaults.info(`  Physical resource: ${physicalName}`);
      await this.ioHelper.defaults.info('');
    }
    await this.ioHelper.defaults.info('Next steps:');
    await this.ioHelper.defaults.info('  1. Update your code to use the new resource type');
    if (mappingJson) {
      await this.ioHelper.defaults.info(`  2. cdk import --resource-mapping '${mappingJson}' --force`);
    } else {
      await this.ioHelper.defaults.info('  2. cdk import');
    }
    await this.ioHelper.defaults.info('  3. cdk deploy');
  }

  /**
   * Find all resources whose aws:cdk:path starts with `<stackName>/<constructPath>/`.
   */
  private findResourcesByPath(resources: Record<string, any>, stackName: string, constructPath: string): string[] {
    const prefix = `${stackName}/${constructPath}/`;
    const ids: string[] = [];

    for (const [id, resource] of Object.entries(resources)) {
      const cdkPath = resource.Metadata?.['aws:cdk:path'] ?? '';
      if (cdkPath.startsWith(prefix)) {
        ids.push(id);
      }
    }

    return ids;
  }

  /**
   * Find the primary resource — the one most likely to be the "main" resource.
   * Uses the shortest aws:cdk:path ending in /Resource as a heuristic.
   */
  /**
   * Find resources in the remaining template that still reference any of the orphaned logical IDs.
   */
  private findBlockingResources(remainingTemplate: any, orphanedIds: string[], fullTemplate: any): string[] {
    const blockers: string[] = [];
    const remaining = remainingTemplate.Resources ?? {};
    const full = fullTemplate.Resources ?? {};

    for (const [id, resource] of Object.entries(full) as [string, any][]) {
      if (orphanedIds.includes(id)) continue;
      if (!remaining[id]) continue;

      let references = false;
      this.walkObject(resource, (value) => {
        if (references) return;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          if (value.Ref && orphanedIds.includes(value.Ref)) references = true;
          const getAtt = value['Fn::GetAtt'];
          if (Array.isArray(getAtt) && orphanedIds.includes(getAtt[0])) references = true;
        }
      });

      // Also check DependsOn
      const deps = resource.DependsOn;
      if (typeof deps === 'string' && orphanedIds.includes(deps)) references = true;
      if (Array.isArray(deps) && deps.some((d: string) => orphanedIds.includes(d))) references = true;

      if (references) {
        const path = (resource as any).Metadata?.['aws:cdk:path'] ?? id;
        blockers.push(path);
      }
    }

    return blockers;
  }

  private findPrimaryResource(logicalIds: string[], resources: Record<string, any>): string {
    const withPaths = logicalIds.map(id => ({
      id,
      path: resources[id].Metadata?.['aws:cdk:path'] ?? '',
    }));

    // Prefer resources whose path ends with /Resource (CDK convention for the main CFN resource)
    const primary = withPaths
      .filter(r => r.path.endsWith('/Resource'))
      .sort((a, b) => a.path.length - b.path.length)[0];

    return primary?.id ?? logicalIds[0];
  }

  /**
   * Extract the resource identifier for CloudFormation import.
   */
  private extractResourceIdentifier(resource: any): Record<string, string> | undefined {
    const props = resource.Properties ?? {};
    if (props.TableName) return { TableName: props.TableName };
    if (props.BucketName) return { BucketName: props.BucketName };
    if (props.QueueName) return { QueueName: props.QueueName };
    if (props.TopicName) return { TopicName: props.TopicName };
    if (props.FunctionName) return { FunctionName: props.FunctionName };
    if (props.RoleName) return { RoleName: props.RoleName };
    return undefined;
  }

  /**
   * Extract the physical name from resource properties.
   */
  private extractPhysicalName(resource: any): string | undefined {
    const props = resource.Properties ?? {};
    return props.TableName ?? props.BucketName ?? props.FunctionName ??
      props.QueueName ?? props.TopicName ?? props.RoleName ?? props.Name;
  }

  /**
   * Resolve Ref and GetAtt values from known resource type patterns.
   */
  /**
   * Resolve all Ref and GetAtt values for orphaned resources.
   *
   * Strategy:
   * - Ref values: from DescribeStackResources (PhysicalResourceId)
   * - GetAtt values: inject temporary Outputs into the step 1 template that
   *   reference each GetAtt. After step 1 deploys, read the resolved values
   *   from DescribeStacks outputs. Fully generic — no service-specific code.
   *
   * Returns the resolved values AND any temporary output keys that were added
   * (so step 2 can remove them).
   */
  private async resolveAllValues(
    stack: cxapi.CloudFormationStackArtifact,
    logicalIds: string[],
    currentTemplate: any,
    templateWithLiterals: any,
  ): Promise<{ values: Map<string, { ref: string; attrs: Record<string, string> }>; tempOutputKeys: string[] }> {
    const sdk = await this.deployments.stackSdk(stack);
    const cfn = sdk.cloudFormation();

    // Get physical resource IDs (Ref values) from CloudFormation
    const describeResult = await cfn.describeStackResources({ StackName: stack.stackName });
    const physicalIds = new Map<string, string>();
    for (const res of describeResult.StackResources ?? []) {
      if (res.LogicalResourceId && res.PhysicalResourceId) {
        physicalIds.set(res.LogicalResourceId, res.PhysicalResourceId);
      }
    }

    // Find all GetAtt references to orphaned resources
    const getAttRefs: { logicalId: string; attr: string; outputKey: string }[] = [];
    const seen = new Set<string>();

    this.walkObject(currentTemplate, (value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const getAtt = value['Fn::GetAtt'];
        if (Array.isArray(getAtt) && logicalIds.includes(getAtt[0])) {
          const key = `${getAtt[0]}.${getAtt[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            const outputKey = `CdkOrphan${getAtt[0]}${getAtt[1]}`.replace(/[^a-zA-Z0-9]/g, '');
            getAttRefs.push({ logicalId: getAtt[0], attr: getAtt[1], outputKey });
          }
        }
      }
    });

    // Add temporary outputs to the step 1 template so CloudFormation resolves the GetAtts
    if (!templateWithLiterals.Outputs) {
      templateWithLiterals.Outputs = {};
    }
    for (const ref of getAttRefs) {
      templateWithLiterals.Outputs[ref.outputKey] = {
        Value: { 'Fn::GetAtt': [ref.logicalId, ref.attr] },
      };
    }

    // Build the result with Ref values now, GetAtt values will be filled after step 1
    const result = new Map<string, { ref: string; attrs: Record<string, string> }>();
    for (const id of logicalIds) {
      result.set(id, { ref: physicalIds.get(id) ?? id, attrs: {} });
    }

    return {
      values: result,
      tempOutputKeys: getAttRefs.map(r => r.outputKey),
    };
  }

  /**
   * After step 1 deploys, read the temporary outputs to get resolved GetAtt values.
   */
  private async readResolvedGetAttValues(
    stack: cxapi.CloudFormationStackArtifact,
    logicalIds: string[],
    currentTemplate: any,
    values: Map<string, { ref: string; attrs: Record<string, string> }>,
  ): Promise<void> {
    const sdk = await this.deployments.stackSdk(stack);
    const cfn = sdk.cloudFormation();

    const stackDesc = await cfn.describeStacks({ StackName: stack.stackName });
    const outputs = new Map<string, string>();
    for (const output of stackDesc.Stacks?.[0]?.Outputs ?? []) {
      if (output.OutputKey && output.OutputValue) {
        outputs.set(output.OutputKey, output.OutputValue);
      }
    }

    // Match outputs back to GetAtt references
    const seen = new Set<string>();
    this.walkObject(currentTemplate, (value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const getAtt = value['Fn::GetAtt'];
        if (Array.isArray(getAtt) && logicalIds.includes(getAtt[0])) {
          const key = `${getAtt[0]}.${getAtt[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            const outputKey = `CdkOrphan${getAtt[0]}${getAtt[1]}`.replace(/[^a-zA-Z0-9]/g, '');
            const resolved = outputs.get(outputKey);
            if (resolved) {
              const entry = values.get(getAtt[0]);
              if (entry) {
                entry.attrs[getAtt[1]] = resolved;
              }
            }
          }
        }
      }
    });
  }

  private replaceReferences(
    template: any,
    logicalId: string,
    values: { ref: string; attrs: Record<string, string> },
  ): void {
    for (const section of ['Resources', 'Outputs', 'Conditions']) {
      if (!template[section]) continue;
      for (const [key, value] of Object.entries(template[section])) {
        if (section === 'Resources' && key === logicalId) continue;
        template[section][key] = this.replaceInObject(value, logicalId, values);
      }
    }
  }

  private replaceInObject(obj: any, logicalId: string, values: { ref: string; attrs: Record<string, string> }): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceInObject(item, logicalId, values));
    }

    if (Object.keys(obj).length === 1 && obj.Ref === logicalId) {
      return values.ref;
    }

    if (Object.keys(obj).length === 1 && Array.isArray(obj['Fn::GetAtt']) && obj['Fn::GetAtt'][0] === logicalId) {
      const attr = obj['Fn::GetAtt'][1];
      if (values.attrs[attr]) {
        return values.attrs[attr];
      }
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.replaceInObject(value, logicalId, values);
    }
    return result;
  }

  private removeDependsOn(template: any, logicalId: string): void {
    for (const resource of Object.values(template.Resources ?? {})) {
      const res = resource as any;
      if (Array.isArray(res.DependsOn)) {
        res.DependsOn = res.DependsOn.filter((dep: string) => dep !== logicalId);
        if (res.DependsOn.length === 0) delete res.DependsOn;
      } else if (res.DependsOn === logicalId) {
        delete res.DependsOn;
      }
    }
  }

  private walkObject(obj: any, visitor: (value: any) => void): void {
    if (obj === null || obj === undefined) return;
    visitor(obj);
    if (typeof obj === 'object') {
      for (const value of Object.values(obj)) {
        this.walkObject(value, visitor);
      }
    }
  }
}
