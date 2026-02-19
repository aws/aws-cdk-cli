import * as crypto from 'node:crypto';
import type { CloudFormationStack } from './cloudformation';
import type { CloudFormationGraph, Resource, StackTemplate } from './resource-graph';
import { CloudFormationParser } from './resource-graph';

export type GraphDirection =
  | 'direct' // Edge A -> B mean that A depends on B
  | 'opposite'; // Edge A -> B mean that B depends on A

/**
 * Computes the digest for each resource in the template.
 *
 * Conceptually, the digest is computed as:
 *
 *     digest(resource) = hash(type + properties + dependencies.map(d))
 *
 * where `hash` is a cryptographic hash function. In other words, the digest of a
 * resource is computed from its type, its own properties (that is, excluding
 * properties that refer to other resources), and the digests of each of its
 * dependencies.
 *
 * The digest of a resource, defined recursively this way, remains stable even if
 * one or more of its dependencies gets renamed. Since the resources in a
 * CloudFormation template form a directed acyclic graph, this function is
 * well-defined.
 */
export function computeResourceDigests(stacks: CloudFormationStack[], direction: GraphDirection = 'direct'): Record<string, string> {
  const exports: { [p: string]: { stackName: string; value: any } } = Object.fromEntries(
    stacks.flatMap((s) =>
      Object.values(s.template.Outputs ?? {})
        .filter((o) => o.Export != null && typeof o.Export.Name === 'string')
        .map(
          (o) =>
            [o.Export.Name, { stackName: s.stackName, value: o.Value }] as [string, { stackName: string; value: any }],
        ),
    ),
  );

  const cfnParser = new CloudFormationParser();
  function convert(stack: CloudFormationStack): StackTemplate {
    return {
      stackId: stack.stackName,
      template: {
        ...stack.template,
        Resources: removeCdkMetadata(stack.template.Resources ?? {}),
      },
    };
  }
  const graph = cfnParser.parseMultiple(stacks.map(convert));
  const adjustedGraph = direction === 'direct' ? graph : graph.opposite();

  return computeDigestsInTopologicalOrder(adjustedGraph, exports);
}

function removeCdkMetadata(resources: Record<string, Resource>): Record<string, Resource> {
  return Object.fromEntries(Object.entries(resources).filter(([_, r]) => r.Type !== 'AWS::CDK::Metadata'));
}

function computeDigestsInTopologicalOrder(
  graph: CloudFormationGraph,
  exports: Record<string, { stackName: string; value: any }>,
): Record<string, string> {
  const nodes = graph.getAllNodesSorted();
  const result: Record<string, string> = {};
  for (const node of nodes) {
    const depDigests = Array.from(graph.getDependencies(node.id)).map((d) => result[d]);
    const propertiesHash = hashObject(stripReferences(stripConstructPathAndId(node), exports));
    result[node.id] = crypto
      .createHash('sha256')
      .update(node.type)
      .update(propertiesHash)
      .update(depDigests.sort().join(''))
      .digest('hex');
  }

  return result;
}

export function hashObject(obj: any): string {
  const hash = crypto.createHash('sha256');

  function addToHash(value: any) {
    if (value == null) {
      addToHash('null');
    } else if (typeof value === 'object') {
      if (Array.isArray(value)) {
        value.forEach(addToHash);
      } else {
        Object.keys(value)
          .sort()
          .forEach((key) => {
            hash.update(key);
            addToHash(value[key]);
          });
      }
    } else {
      hash.update(typeof value + value.toString());
    }
  }

  addToHash(obj);
  return hash.digest('hex');
}

/**
 * Removes sub-properties containing Ref or Fn::GetAtt to avoid hashing
 * references themselves but keeps the property structure.
 */
function stripReferences(value: any, exports: { [p: string]: { stackName: string; value: any } }): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(x => stripReferences(x, exports));
  }
  if ('Ref' in value) {
    return { __cloud_ref__: 'Ref' };
  }
  if ('Fn::GetAtt' in value) {
    return { __cloud_ref__: 'Fn::GetAtt' };
  }
  if ('DependsOn' in value) {
    return { __cloud_ref__: 'DependsOn' };
  }
  if ('Fn::ImportValue' in value) {
    const exp = exports[value['Fn::ImportValue']];
    if (exp != null) {
      const v = exp.value;
      if (v != null && typeof v === 'object') {
        // Treat Fn::ImportValue as if it were a reference with the same stack
        if ('Ref' in v) {
          return { __cloud_ref__: 'Ref' };
        } else if ('Fn::GetAtt' in v) {
          return { __cloud_ref__: 'Fn::GetAtt' };
        }
      } else {
        // If the export value is a primitive, we can just use it directly
        return v;
      }
    }
  }
  const result: any = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = stripReferences(v, exports);
  }
  return result;
}

// TODO rename this function
function stripConstructPathAndId(resource: any): any {
  const copy = JSON.parse(JSON.stringify(resource));
  if (resource?.metadata?.['aws:cdk:path'] != null) {
    delete copy.metadata['aws:cdk:path'];
  }
  delete copy.id;
  delete copy.stackId;
  return copy;
}
