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
 * Split construct paths into a stack ID and construct-level paths.
 *
 * The stack is the longest `availableStackIds` entry that prefixes the path,
 * so staged stacks (slash-delimited `hierarchicalId`) resolve correctly. All
 * paths must reference the same stack.
 */
export function resolveStackAndConstructPaths(
  paths: string[],
  availableStackIds: string[],
): { stackId: string; constructPaths: string[] } {
  if (paths.length === 0) {
    throw new ToolkitError('MissingConstructPath', 'At least one construct path is required (e.g. cdk orphan MyStack/MyTable)');
  }

  const constructPaths: string[] = [];
  let stackId: string | undefined;

  for (const raw of paths) {
    const p = raw.replace(/^\//, ''); // strip leading slash

    // Longest stack ID that prefixes the path, e.g. 'MyStage/MyStack' for 'MyStage/MyStack/MyBucket'.
    const matchedStack = availableStackIds
      .filter((id) => p === id || p.startsWith(`${id}/`))
      .sort((a, b) => b.length - a.length)[0];

    if (!matchedStack) {
      throw new ToolkitError(
        'StackNotFound',
        `No stack found for construct path '${raw}'. Available stacks: ${availableStackIds.join(', ')}`,
      );
    }

    const constructPath = p.substring(matchedStack.length + 1);
    if (constructPath === '') {
      throw new ToolkitError(
        'InvalidConstructPath',
        `Construct path '${raw}' must include a construct path within the stack (e.g. ${matchedStack}/MyTable)`,
      );
    }

    if (stackId && matchedStack !== stackId) {
      throw new ToolkitError('MultipleStacks', `All construct paths must reference the same stack, but got '${stackId}' and '${matchedStack}'`);
    }
    stackId = matchedStack;
    constructPaths.push(constructPath);
  }

  return { stackId: stackId!, constructPaths };
}
