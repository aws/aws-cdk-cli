/*
 * The Cloudformation refactoring API needs, in addition to the mappings, the
 * resulting templates for each affected stack. The resulting templates are
 * basically the synthesis produced, but with some differences:
 *
 * - Resources that exist in the local stacks, but not in the remote stacks, are
 *   not included.
 * - Resources that exist in the remote stacks, but not in the local stacks, are
 *   preserved.
 * - For resources that exist in both stacks, but have different properties, the
 *   deployed properties are used, but the references may need to be updated, if
 *   the resources they reference were moved in the refactoring.
 *
 * Why does the last difference exist, to begin with? By default, to establish
 * whether two given resources are the same, roughly speaking we compute the hash
 * of their properties and compare them. But there is a better source of resource
 * identity, that we can exploit when it is present: the physical name. In such
 * cases, we can track a resource move even if the properties are different, as
 * long as the physical name is the same.
 *
 * The process of computing the resulting templates consists in:
 *
 * 1. Computing a graph of deployed resources.
 * 2. Mapping edges and nodes according to the mappings (that we either
 *    computed or got directly from the user).
 * 3. Computing the resulting templates by traversing the graph and
 *    collecting the resources that are not mapped out, and updating the
 *    references to the resources that were moved.
 */

import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import type { CloudFormationStack, CloudFormationTemplate, ResourceMapping } from './cloudformation';
import { ResourceLocation } from './cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';

export function generateStackDefinitions(
  mappings: ResourceMapping[],
  deployedStacks: CloudFormationStack[],
  localStacks: CloudFormationStack[],
): StackDefinition[] {
  const edgeMapper = new EdgeMapper(mappings);

  // Build a graph of the deployed stacks
  const deployedGraph = graph(deployedStacks);

  // Map all the edges, including their endpoints, to their new locations.
  const edges = edgeMapper.mapEdges(deployedGraph.edges);

  // All the edges have been mapped, which means that isolated nodes were left behind. Map them too.
  const nodes = mapNodes(deployedGraph.isolatedNodes, mappings);

  // Now we can generate the templates for each stack
  const templates = generateTemplates(edges, nodes, edgeMapper.affectedStackNames, localStacks, deployedStacks);

  // Finally, generate the stack definitions, to be included in the refactor request.
  return Object.entries(templates).map(([stackName, template]) => ({
    StackName: stackName,
    TemplateBody: JSON.stringify(template),
  }));
}

function graph(deployedStacks: CloudFormationStack[]): { edges: ResourceEdge[]; isolatedNodes: ResourceNode[] } {
  const deployedExports: Record<string, ScopedExport> = indexExports(deployedStacks);
  const deployedNodeMap: Map<string, ResourceNode> = buildNodes(deployedStacks);
  const resourceNamesByStack = indexResourceNames(deployedStacks);
  const deployedNodes = Array.from(deployedNodeMap.values());

  const edges = buildEdges(deployedNodeMap, deployedExports, resourceNamesByStack);

  const isolatedNodes = deployedNodes.filter((node) => {
    return !edges.some(
      (edge) =>
        edge.source.location.equalTo(node.location) ||
        edge.targets.some((target) => target.location.equalTo(node.location)),
    );
  });

  return { edges, isolatedNodes };
}

function buildNodes(stacks: CloudFormationStack[]): Map<string, ResourceNode> {
  const result = new Map<string, ResourceNode>();
  for (const stack of stacks) {
    const template = stack.template;
    buildForSection(stack, 'Resource', template.Resources);
    buildForSection(stack, 'Output', template.Outputs);
  }
  return result;

  function buildForSection(stack: CloudFormationStack, nodeType: NodeType, section?: Record<string, any>) {
    for (const [logicalId, resource] of Object.entries(section ?? {})) {
      result.set(`${stack.stackName}.${logicalId}`, {
        type: nodeType,
        location: new ResourceLocation(stack, logicalId),
        rawValue: resource,
      });
    }
  }
}

function buildEdges(
  nodeMap: Map<string, ResourceNode>,
  exports: Record<string, ScopedExport>,
  resourceNamesByStack: Record<string, string[]>,
): ResourceEdge[] {
  const nodes = Array.from(nodeMap.values());
  return nodes.flatMap((node) => buildEdgesForResource(node, node.rawValue));

  function buildEdgesForResource(source: ResourceNode, value: any, path: string[] = []): ResourceEdge[] {
    const resourceNames = resourceNamesByStack[source.location.stack.stackName] ?? [];

    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
      return value.flatMap((x, index) => buildEdgesForResource(source, x, path.concat(String(index))));
    }

    if ('Ref' in value) {
      if (!resourceNames.includes(value.Ref)) {
        return [];
      }

      return [makeRef(source.location.stack.stackName, value.Ref)];
    }

    if ('Fn::GetAtt' in value) {
      const logicalId = Array.isArray(value['Fn::GetAtt']) ? value['Fn::GetAtt'][0] : value['Fn::GetAtt'];
      if (!resourceNames.includes(logicalId)) {
        return [];
      }

      return [makeGetAtt(source.location.stack.stackName, value['Fn::GetAtt'])];
    }

    if ('Fn::ImportValue' in value) {
      const exportName = value['Fn::ImportValue'];
      const x = exports[exportName]!;

      if ('Ref' in x.value) {
        return [
          {
            ...makeRef(x.stackName, x.value.Ref),
            reference: new ImportValue(Ref.INSTANCE),
          },
        ];
      }

      if ('Fn::GetAtt' in x.value) {
        const getAtt = makeGetAtt(x.stackName, x.value['Fn::GetAtt']);
        return [
          {
            ...getAtt,
            reference: new ImportValue(getAtt.reference),
          },
        ];
      }

      return [];
    }

    if ('Fn::Sub' in value) {
      let inputString: string;
      let variables: Record<string, any> = {};
      const sub = value['Fn::Sub'];
      if (typeof sub === 'string') {
        inputString = sub;
      } else {
        [inputString, variables] = sub;
      }

      let varNames = Array.from(inputString.matchAll(/\${([a-zA-Z0-9_.]+)}/g))
        .map((x) => x[1])
        .filter((varName) => {
          const [logicalId] = varName.split(/\.(.*)/s);
          return resourceNames.includes(logicalId);
        });

      const targets = varNames.map((varName) => {
        return varName.includes('.')
          ? makeGetAtt(source.location.stack.stackName, varName)
          : makeRef(source.location.stack.stackName, varName);
      }).flatMap((e) => e.targets);

      const edgesFromInputString = targets.length > 0
        ? [{
          source,
          targets,
          reference: new Sub(inputString, varNames),
          path: typeof sub === 'string' ? path.concat('Fn::Sub') : path.concat('Fn::Sub', '0'),
        }] : [];

      const edgesFromVariables = buildEdgesForResource(source, variables, path.concat('Fn::Sub', '1'));

      return [...edgesFromInputString, ...edgesFromVariables];
    }

    const edges: ResourceEdge[] = [];

    // DependsOn is only handled at the top level of the resource
    if ('DependsOn' in value && path.length === 0) {
      if (typeof value.DependsOn === 'string') {
        edges.push({
          ...makeRef(source.location.stack.stackName, value.DependsOn),
          reference: DependsOn.INSTANCE,
        });
      } else if (Array.isArray(value.DependsOn)) {
        edges.push({
          source,
          targets: value.DependsOn.flatMap(
            (dependsOn: string) => makeRef(source.location.stack.stackName, dependsOn).targets,
          ),
          path: path.concat('DependsOn'),
          reference: DependsOn.INSTANCE,
        });
      }
    }

    edges.push(...Object.entries(value).flatMap(([k, v]) => buildEdgesForResource(source, v, path.concat(k))));

    return edges;

    function makeRef(stackName: string, logicalId: string): ResourceEdge {
      const key = `${stackName}.${logicalId}`;
      const target = nodeMap.get(key)!;

      return {
        path,
        source,
        targets: [target],
        reference: Ref.INSTANCE,
      };
    }

    function makeGetAtt(stackName: string, att: string | string[]): ResourceEdge {
      let logicalId: string = '';
      let attributeName: string = '';
      if (typeof att === 'string') {
        [logicalId, attributeName] = att.split(/\.(.*)/s);
      } else if (Array.isArray(att) && att.length === 2) {
        [logicalId, attributeName] = att;
      }

      const key = `${stackName}.${logicalId}`;
      const target = nodeMap.get(key)!;

      return {
        path,
        source,
        targets: [target],
        reference: new GetAtt(attributeName),
      };
    }
  }
}

function mapNodes(nodes: ResourceNode[], mappings: ResourceMapping[]): ResourceNode[] {
  return nodes.map((node) => {
    const newLocation = mapLocation(node.location, mappings);
    return {
      type: node.type,
      location: newLocation,
      rawValue: node.rawValue,
    } as ResourceNode;
  });
}

function generateTemplates(
  edges: ResourceEdge[],
  nodes: ResourceNode[],
  stackNames: string[],
  localStacks: CloudFormationStack[],
  deployedStacks: CloudFormationStack[],
): Record<string, CloudFormationTemplate> {
  updateReferences(edges, indexExports(localStacks));

  const templates: Record<string, CloudFormationTemplate> = {};

  // Take the CloudFormation raw value of each the node and put it into the appropriate template.
  const allNodes = unique(edges.flatMap((e) => [e.source, ...e.targets]).concat(nodes));
  allNodes.forEach((node) => {
    const stackName = node.location.stack.stackName;
    const logicalId = node.location.logicalResourceId;

    if (node.type !== 'Resource') {
      return;
    }

    if (templates[stackName] === undefined) {
      templates[stackName] = {
        Resources: {},
      };
    }
    templates[stackName].Resources![logicalId] = node.rawValue;
  });

  // Add outputs to the templates
  for (const edge of edges) {
    if (edge.reference instanceof ImportValue) {
      const targetStackName = edge.targets[0].location.stack.stackName;
      const targetTemplate = templates[targetStackName];

      if (edge.reference.output != null) {
        targetTemplate.Outputs = {
          ...(targetTemplate.Outputs ?? {}),
          ...edge.reference.output,
        };
      }
    }
  }

  // The freshly generated templates contain only resources and outputs.
  // Combine them with the existing templates to preserve metadata and other properties.
  return Object.fromEntries(
    stackNames.map((stackName) => {
      const oldTemplate = deployedStacks.find((s) => s.stackName === stackName)?.template ?? {};
      const newTemplate = templates[stackName] ?? { Resources: {} };

      // Remove outputs
      // TODO rename this variable
      const interestingEdges = edges.filter(e => e.deleteOutputs && e.targets[0].location.stack.stackName === stackName);
      for (const edge of interestingEdges) {
        Object
          .entries(oldTemplate.Outputs ?? {})
          .filter(([_, output]) => outputMatchesEdge(output, edge))
          .forEach(([name, _]) => {
            delete oldTemplate.Outputs?.[name];
          });
      }

      const combinedTemplate = { ...oldTemplate, ...newTemplate };

      sanitizeDependencies(combinedTemplate);
      return [stackName, combinedTemplate];
    }),
  );
}

function outputMatchesEdge(output: any, edge: ResourceEdge): boolean {
  if (edge.reference instanceof Ref) {
    const candidates = edge.targets.map(t => t.location.logicalResourceId);
    const logicalId = output.Value.Ref;
    return candidates.includes(logicalId);
  }

  if (edge.reference instanceof GetAtt) {
    const candidates = edge.targets.map(t => t.location.logicalResourceId);
    const getAtt = output.Value['Fn::GetAtt'];
    if (!getAtt == null) {
      return false;
    }
    const [logicalId, attr] = Array.isArray(getAtt) ? getAtt : getAtt.split(/\.(.*)/s);
    return candidates.includes(logicalId) && edge.reference.attributeName === attr;
  }

  return false;
}

/**
 * Update the CloudFormation resources based on information from the edges.
 * Each edge corresponds to a path in some resource object. The value at that
 * path is updated to the CloudFormation value represented by the edge's annotation.
 */
function updateReferences(edges: ResourceEdge[], exports: Record<string, ScopedExport>) {
  for (const edge of edges) {
    try {
      const cfnValue = edge.reference.toCfn(edge.targets, exports);
      const obj = edge.path.slice(0, edge.path.length - 1).reduce(getPropValue, edge.source.rawValue);
      setPropValue(obj, edge.path[edge.path.length - 1], cfnValue);
    } catch (e: any) {
      if (e.name === 'ExportNotFoundError') {
        const src = edge.source.location.toPath();
        const target = edge.targets[0].location.toPath();
        const message = `This refactor operation would introduce a cross-stack reference from resource ${src} to ${target}. ` +
          'But there is no export in your local CDK app that can be used to implement this reference. ' +
          'If you think these resources should be in the same stack, re-run the command with mapping overrides.';
        throw new ToolkitError(message);
      } else {
        throw e;
      }
    }
  }

  function getPropValue(obj: any, prop: string): any {
    const index = parseInt(prop);
    return obj[Number.isNaN(index) ? prop : index];
  }

  function setPropValue(obj: any, prop: string, value: any) {
    const index = parseInt(prop);
    obj[Number.isNaN(index) ? prop : index] = value;
  }
}

class EdgeMapper {
  public readonly affectedStacks: Set<string> = new Set();
  private readonly nodeMap: Map<string, ResourceNode> = new Map();

  constructor(private readonly mappings: ResourceMapping[]) {
    mappings
      .flatMap((m) => [m.source.stack.stackName, m.destination.stack.stackName])
      .forEach(stackName => this.affectedStacks.add(stackName));
  }

  /**
   * For each input edge, produce an output edge such that:
   *   - The source and targets are mapped to their new locations
   *   - The annotation is converted between in-stack and cross-stack references, as appropriate
   */
  mapEdges(edges: ResourceEdge[]): ResourceEdge[] {
    return edges
      .map((edge) => {
        const oldSource = edge.source;
        const oldTargets = edge.targets;
        const newSource = this.mapNode(oldSource);
        const newTargets = oldTargets.map((t) => this.mapNode(t));

        const oldSourceStackName = oldSource.location.stack.stackName;
        const oldTargetStackName = oldTargets[0].location.stack.stackName;

        const newSourceStackName = newSource.location.stack.stackName;
        const newTargetStackName = newTargets[0].location.stack.stackName;

        const targetWasMoved = !newTargets[0].location.equalTo(oldTargets[0].location);
        if (targetWasMoved) {
          // Moving the target also affects the stacks that contain the source
          this.affectedStacks.add(newSourceStackName);
          this.affectedStacks.add(oldSourceStackName);
        }

        let deleteOutputs = false;
        let reference: CloudFormationReference = edge.reference;
        if (oldSourceStackName === oldTargetStackName && newSourceStackName !== newTargetStackName) {
          if (edge.reference instanceof DependsOn) {
            return undefined;
          }

          // in-stack reference to cross-stack reference: wrap the old annotation
          reference = new ImportValue(edge.reference);
        } else if (oldSourceStackName !== oldTargetStackName && newSourceStackName === newTargetStackName) {
          // cross-stack reference to in-stack reference: unwrap the old annotation
          if (edge.reference instanceof ImportValue) {
            reference = edge.reference.reference;
            deleteOutputs = true;
          }
        }

        return {
          path: edge.path,
          source: newSource,
          targets: newTargets,
          reference,
          deleteOutputs,
        } as ResourceEdge;
      })
      .filter((edge) => edge !== undefined);
  }

  get affectedStackNames(): string[] {
    return Array.from(this.affectedStacks);
  }

  private mapNode(node: ResourceNode): ResourceNode {
    const newLocation = mapLocation(node.location, this.mappings);
    const key = `${newLocation.stack.stackName}.${newLocation.logicalResourceId}`;
    if (!this.nodeMap.has(key)) {
      this.nodeMap.set(key, {
        type: node.type,
        location: newLocation,
        rawValue: node.rawValue,
      });
    }
    return this.nodeMap.get(key)!;
  }
}

function mapLocation(location: ResourceLocation, mappings: ResourceMapping[]): ResourceLocation {
  const mapping = mappings.find((m) => m.source.equalTo(location));
  if (mapping) {
    return mapping.destination;
  }
  return location;
}

function indexExports(stacks: CloudFormationStack[]): Record<string, ScopedExport> {
  return Object.fromEntries(
    stacks.flatMap((s) =>
      Object.entries(s.template.Outputs ?? {})
        .filter(
          ([_, o]) => typeof o.Export?.Name === 'string' && (o.Value.Ref != null || o.Value['Fn::GetAtt'] != null),
        )
        .map(([name, o]) => [o.Export.Name, { stackName: s.stackName, outputName: name, value: o.Value }]),
    ),
  );
}

/**
 * Returns a map from stack name to the logical IDs of all resources in that stack.
 */
function indexResourceNames(stacks: CloudFormationStack[]): Record<string, string[]> {
  return Object.fromEntries(
    stacks.map((s) => [s.stackName, Object.keys(s.template.Resources ?? {})]),
  );
}

function unique<T>(arr: Array<T>) {
  return Array.from(new Set(arr));
}

/**
 * Updates the DependsOn property of all resources, removing references
 * to resources that do not exist in the template. Unlike Refs and GetAtts,
 * which get transformed to ImportValues when the referenced resource is
 * moved to another stack, DependsOn doesn't cross stack boundaries.
 */
function sanitizeDependencies(template: CloudFormationTemplate) {
  const resources = template.Resources ?? {};
  for (const resource of Object.values(resources)) {
    if (typeof resource.DependsOn === 'string' && resources[resource.DependsOn] == null) {
      delete resource.DependsOn;
    }

    if (Array.isArray(resource.DependsOn)) {
      resource.DependsOn = resource.DependsOn.filter((dep) => resources[dep] != null);
      if (resource.DependsOn.length === 0) {
        delete resource.DependsOn;
      }
    }
  }
}

interface ScopedExport {
  stackName: string;
  outputName: string;
  value: any;
}

type NodeType = 'Resource' | 'Output';

interface ResourceNode {
  type: NodeType;
  location: ResourceLocation;
  rawValue: any;
}

/**
 * An edge in the resource graph, representing a reference from one resource
 * to one or more target resources. (Technically, a hyperedge.)
 */
interface ResourceEdge {
  /**
   * The source resource of the edge.
   */
  source: ResourceNode;

  /**
   * The target resources of the edge. In case of DependsOn,
   * this can be multiple resources.
   */
  targets: ResourceNode[];

  /**
   * The path in the source resource where the reference is located.
   */
  path: string[];

  /**
   * The CloudFormation reference that this edge represents.
   */
  reference: CloudFormationReference;

  // TODO rename this
  deleteOutputs?: boolean;
}

interface CloudFormationReference {
  toCfn(targets: ResourceNode[], exports: Record<string, ScopedExport>): any;
}

class Ref implements CloudFormationReference {
  public static INSTANCE = new Ref();

  private constructor() {
  }

  toCfn(targets: ResourceNode[]): any {
    return { Ref: targets[0].location.logicalResourceId };
  }
}

class GetAtt implements CloudFormationReference {
  constructor(public readonly attributeName: string) {
  }

  toCfn(targets: ResourceNode[]): any {
    return {
      'Fn::GetAtt': [targets[0].location.logicalResourceId, this.attributeName],
    };
  }
}

class ImportValue implements CloudFormationReference {
  private outputName?: string;
  private outputContent?: any;

  constructor(public readonly reference: CloudFormationReference) {
  }

  toCfn(targets: ResourceNode[], exports: Record<string, ScopedExport>): any {
    const target = targets[0];
    const exp = this.findExport(target, exports);
    if (exp) {
      this.outputName = exp[1].outputName;
      this.outputContent = {
        Value: exp[1].value,
        Export: {
          Name: exp[0],
        },
      };
      return { 'Fn::ImportValue': exp[0] };
    }

    throw new ExportNotFoundError();
  }

  toString(): string {
    return `ImportValue${this.reference.toString()}`;
  }

  private findExport(target: ResourceNode, exports: Record<string, ScopedExport>) {
    if (this.reference instanceof Ref) {
      return Object.entries(exports).find(([_, exportValue]) => {
        return (
          exportValue.stackName === target.location.stack.stackName &&
          exportValue.value.Ref === target.location.logicalResourceId
        );
      });
    } else {
      return Object.entries(exports).find(([_, exportValue]) => {
        const getAtt = this.reference as GetAtt;

        return (
          exportValue.stackName === target.location.stack.stackName &&
          exportValue.value['Fn::GetAtt'] &&
          ((exportValue.value['Fn::GetAtt'][0] === target.location.logicalResourceId &&
              exportValue.value['Fn::GetAtt'][1] === getAtt.attributeName) ||
            exportValue.value['Fn::GetAtt'] === `${target.location.logicalResourceId}.${getAtt.attributeName}`)
        );
      });
    }
  }

  get output(): Record<string, any> | undefined {
    if (this.outputName == null) {
      return undefined;
    }
    return { [this.outputName]: this.outputContent };
  }
}

class Sub implements CloudFormationReference {
  constructor(public readonly inputString: string, public readonly varNames: string[]) {
  }

  toCfn(targets: ResourceNode[]): any {
    let inputString = this.inputString;

    this.varNames.forEach((varName, index) => {
      const [_, attr] = varName.split(/\.(.*)/s);
      const target = targets[index];
      inputString = inputString.replace(
        `\${${varName}`,
        `\${${target.location.logicalResourceId}${attr ? `.${attr}` : ''}`,
      );
    });

    return inputString;
  }
}

class DependsOn implements CloudFormationReference {
  public static INSTANCE = new DependsOn();

  private constructor() {
  }

  toCfn(targets: ResourceNode[]): any {
    return targets.map((t) => t.location.logicalResourceId);
  }
}

export class ExportNotFoundError extends ToolkitError {
  // TODO better message and parameters.
  constructor() {
    super('Export not found');
  }
}
