import { PATH_METADATA_KEY } from '@aws-cdk/cloud-assembly-api';

/**
 * Walk an object tree depth-first, calling visitor on every node.
 */
export function walkObject(obj: any, visitor: (value: any) => void): void {
  if (obj === null || obj === undefined) return;
  visitor(obj);
  if (typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      walkObject(value, visitor);
    }
  }
}

/**
 * Replace all {Ref}, {Fn::GetAtt}, and {Fn::Sub} references to a logical ID with literal values.
 */
export function replaceInObject(obj: any, logicalId: string, values: { ref: string; attrs: Record<string, string> }): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => replaceInObject(item, logicalId, values));
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

  // Handle Fn::Sub implicit references: ${LogicalId} and ${LogicalId.Attr}
  if (obj['Fn::Sub'] !== undefined) {
    const sub = obj['Fn::Sub'];
    const replaceSubString = (str: string): string => {
      // Replace ${LogicalId.Attr} with the resolved attribute value
      for (const [attr, val] of Object.entries(values.attrs)) {
        str = str.replace(new RegExp(`\\$\\{${logicalId}\\.${attr}\\}`, 'g'), val);
      }
      // Replace ${LogicalId} with the resolved Ref value
      str = str.replace(new RegExp(`\\$\\{${logicalId}\\}`, 'g'), values.ref);
      return str;
    };

    if (typeof sub === 'string') {
      return { 'Fn::Sub': replaceSubString(sub) };
    }
    if (Array.isArray(sub) && typeof sub[0] === 'string') {
      return {
        'Fn::Sub': [
          replaceSubString(sub[0]),
          sub[1] ? replaceInObject(sub[1], logicalId, values) : sub[1],
        ],
      };
    }
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = replaceInObject(value, logicalId, values);
  }
  return result;
}

/**
 * Replace all references to a logical ID across Resources, Outputs, and Conditions.
 */
export function replaceReferences(
  template: any,
  logicalId: string,
  values: { ref: string; attrs: Record<string, string> },
): void {
  for (const section of ['Resources', 'Outputs', 'Conditions']) {
    if (!template[section]) continue;
    for (const [key, value] of Object.entries(template[section])) {
      if (section === 'Resources' && key === logicalId) continue;
      template[section][key] = replaceInObject(value, logicalId, values);
    }
  }
}

/**
 * Remove all DependsOn references to a logical ID from the template.
 */
export function removeDependsOn(template: any, logicalId: string): void {
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

/**
 * Find all resources whose aws:cdk:path starts with `<stackName>/<constructPath>/`.
 */
export function findResourcesByPath(resources: Record<string, any>, stackName: string, constructPath: string): string[] {
  const prefix = `${stackName}/${constructPath}/`;
  const ids: string[] = [];
  for (const [id, resource] of Object.entries(resources)) {
    const cdkPath = resource.Metadata?.[PATH_METADATA_KEY] ?? '';
    if (cdkPath.startsWith(prefix)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Find resources in the remaining template that still reference any of the orphaned logical IDs.
 */
export function findBlockingResources(remainingTemplate: any, orphanedIds: string[], fullTemplate: any): string[] {
  const blockers: string[] = [];
  const remaining = remainingTemplate.Resources ?? {};
  const full = fullTemplate.Resources ?? {};

  for (const [id, resource] of Object.entries(full) as [string, any][]) {
    if (orphanedIds.includes(id)) continue;
    if (!remaining[id]) continue;

    let references = false;
    walkObject(resource, (value) => {
      if (references) return;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (value.Ref && orphanedIds.includes(value.Ref)) references = true;
        const getAtt = value['Fn::GetAtt'];
        if (Array.isArray(getAtt) && orphanedIds.includes(getAtt[0])) references = true;
      }
    });

    const deps = resource.DependsOn;
    if (typeof deps === 'string' && orphanedIds.includes(deps)) references = true;
    if (Array.isArray(deps) && deps.some((d: string) => orphanedIds.includes(d))) references = true;

    if (references) {
      const path = (resource as any).Metadata?.[PATH_METADATA_KEY] ?? id;
      blockers.push(path);
    }
  }

  return blockers;
}

/**
 * Check if any resources in the template have aws:cdk:path metadata at all.
 * Used to detect if metadata has been disabled.
 */
export function hasAnyCdkPathMetadata(resources: Record<string, any>): boolean {
  for (const resource of Object.values(resources)) {
    if ((resource as any).Metadata?.[PATH_METADATA_KEY]) {
      return true;
    }
  }
  return false;
}

import { ToolkitError } from '../../../toolkit/toolkit-error';
import type { DeployStackResult, SuccessfulDeployStackResult } from '../../deployments/deployment-result';

/**
 * Verify a deploy result completed successfully.
 */
export function assertDeploySucceeded(result: DeployStackResult, step: string): asserts result is SuccessfulDeployStackResult {
  if (result.type !== 'did-deploy-stack') {
    throw new ToolkitError('OrphanDeployFailed', `${step}: unexpected deployment result '${result.type}'`);
  }
}

/**
 * CloudFormation requires at least one resource in the template.
 * Add a placeholder if all resources were removed.
 */
export function ensureNonEmptyResources(template: any): void {
  if (Object.keys(template.Resources ?? {}).length === 0) {
    template.Resources = {
      CDKOrphanPlaceholder: {
        Type: 'AWS::CloudFormation::WaitConditionHandle',
      },
    };
  }
}

/**
 * Parse construct paths like `/MyStack/MyTable` or `MyStack/MyTable` into
 * a stack construct ID and construct-level paths.
 *
 * All paths must reference the same stack.
 */
export function parseAndValidateConstructPaths(paths: string[]): { stackId: string; constructPaths: string[] } {
  if (paths.length === 0) {
    throw new ToolkitError('MissingConstructPath', 'At least one construct path is required (e.g. --path MyStack/MyTable)');
  }

  const constructPaths: string[] = [];
  let stackId: string | undefined;

  for (const raw of paths) {
    const p = raw.replace(/^\//, ''); // strip leading slash
    const slashIdx = p.indexOf('/');
    if (slashIdx < 0) {
      throw new ToolkitError('InvalidConstructPath', `Construct path '${raw}' must include both a stack name and a construct path separated by '/' (e.g. MyStack/MyTable)`);
    }

    const thisStack = p.substring(0, slashIdx);
    const constructPath = p.substring(slashIdx + 1);

    if (stackId && thisStack !== stackId) {
      throw new ToolkitError('MultipleStacks', `All construct paths must reference the same stack, but got '${stackId}' and '${thisStack}'`);
    }
    stackId = thisStack;
    constructPaths.push(constructPath);
  }

  return { stackId: stackId!, constructPaths };
}
