import * as crypto from 'node:crypto';
import type { CloudFormationTemplate } from './cloudformation';

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
export function computeResourceDigests(template: CloudFormationTemplate): Record<string, string> {
  const resources = template.Resources || {};
  const graph: Record<string, Set<string>> = {};
  const reverseGraph: Record<string, Set<string>> = {};

  // 1. Build adjacency lists
  for (const id of Object.keys(resources)) {
    graph[id] = new Set();
    reverseGraph[id] = new Set();
  }

  // 2. Detect dependencies by searching for Ref/Fn::GetAtt
  const findDependencies = (value: any): string[] => {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
      return value.flatMap(findDependencies);
    }
    if ('Ref' in value) {
      return [value.Ref];
    }
    if ('Fn::GetAtt' in value) {
      const refTarget = Array.isArray(value['Fn::GetAtt']) ? value['Fn::GetAtt'][0] : value['Fn::GetAtt'].split('.')[0];
      return [refTarget];
    }
    if ('DependsOn' in value) {
      return [value.DependsOn];
    }
    return Object.values(value).flatMap(findDependencies);
  };

  for (const [id, res] of Object.entries(resources)) {
    const deps = findDependencies(res || {});
    for (const dep of deps) {
      if (dep in resources && dep !== id) {
        graph[id].add(dep);
        reverseGraph[dep].add(id);
      }
    }
  }

  // 3. Topological sort
  const outDegree = Object.keys(graph).reduce((acc, k) => {
    acc[k] = graph[k].size;
    return acc;
  }, {} as Record<string, number>);

  const queue = Object.keys(outDegree).filter((k) => outDegree[k] === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const nxt of reverseGraph[node]) {
      outDegree[nxt]--;
      if (outDegree[nxt] === 0) {
        queue.push(nxt);
      }
    }
  }

  // 4. Compute digests in sorted order
  const result: Record<string, string> = {};
  for (const id of order) {
    const resource = resources[id];
    const depDigests = Array.from(graph[id]).map((d) => result[d]);
    const propsWithoutRefs = hashObject(stripReferences(stripConstructPath(resource)));
    const toHash = resource.Type + propsWithoutRefs + depDigests.join('');
    result[id] = crypto.createHash('sha256').update(toHash).digest('hex');
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
function stripReferences(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(stripReferences);
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
  const result: any = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = stripReferences(v);
  }
  return result;
}

function stripConstructPath(resource: any): any {
  if (resource?.Metadata?.['aws:cdk:path'] == null) {
    return resource;
  }

  const copy = JSON.parse(JSON.stringify(resource));
  delete copy.Metadata['aws:cdk:path'];
  return copy;
}
