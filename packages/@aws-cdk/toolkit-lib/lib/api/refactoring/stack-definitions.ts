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
import type { ICloudFormationClient, ICloudControlClient } from '../aws-auth/private';

export function generateStackDefinitions(
  mappings: ResourceMapping[],
  deployedStacks: CloudFormationStack[],
  localStacks: CloudFormationStack[],
): StackDefinition[] {
  const localExports: Record<string, ScopedExport> = indexExports(localStacks);
  const deployedExports: Record<string, ScopedExport> = indexExports(deployedStacks);
  const edgeMapper = new EdgeMapper(mappings);

  // Build a graph of the deployed stacks
  const deployedGraph = graph(deployedStacks, deployedExports);

  // Map all the edges, including their endpoints, to their new locations.
  const edges = edgeMapper.mapEdges(deployedGraph.edges);

  // All the edges have been mapped, which means that isolated nodes were left behind. Map them too.
  const nodes = mapNodes(deployedGraph.isolatedNodes, mappings);

  // Now we can generate the templates for each stack
  const templates = generateTemplates(edges, nodes, edgeMapper.affectedStackNames, localExports, deployedStacks);

  // Finally, generate the stack definitions, to be included in the refactor request.
  return Object.entries(templates).map(([stackName, template]) => ({
    StackName: stackName,
    TemplateBody: JSON.stringify(template),
  }));
}

function graph(deployedStacks: CloudFormationStack[], deployedExports: Record<string, ScopedExport>):
{ edges: ResourceEdge[]; isolatedNodes: ResourceNode[] } {
  const deployedNodeMap: Map<string, ResourceNode> = buildNodes(deployedStacks);
  const deployedNodes = Array.from(deployedNodeMap.values());

  const edges = buildEdges(deployedNodeMap, deployedExports);

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
    for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
      const location = new ResourceLocation(stack, logicalId);
      result.set(`${stack.stackName}.${logicalId}`, {
        location,
        rawValue: resource,
      });
    }
  }

  return result;
}

function buildEdges(
  nodeMap: Map<string, ResourceNode>,
  exports: Record<
    string,
    {
      stackName: string;
      value: any;
    }
  >,
): ResourceEdge[] {
  const nodes = Array.from(nodeMap.values());
  return nodes.flatMap((node) => buildEdgesForResource(node, node.rawValue));

  function buildEdgesForResource(source: ResourceNode, value: any, path: string[] = []): ResourceEdge[] {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
      return value.flatMap((x, index) => buildEdgesForResource(source, x, path.concat(String(index))));
    }

    if ('Ref' in value) {
      return [makeRef(source.location.stack.stackName, value.Ref)];
    }

    if ('Fn::GetAtt' in value) {
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
      let variables: Record<string, any> | undefined;
      const sub = value['Fn::Sub'];
      if (typeof sub === 'string') {
        inputString = sub;
      } else {
        [inputString, variables] = sub;
      }

      let varNames = Array.from(inputString.matchAll(/\${([a-zA-Z0-9_.]+)}/g))
        .map((x) => x[1])
        .filter((varName) => (value['Fn::Sub'][1] ?? {})[varName] == null);

      const edges = varNames.map((varName) => {
        return varName.includes('.')
          ? makeGetAtt(source.location.stack.stackName, varName)
          : makeRef(source.location.stack.stackName, varName);
      });

      const edgesFromInputString = [
        {
          source,
          targets: edges.flatMap((edge) => edge.targets),
          reference: new Sub(inputString, varNames),
          path: path.concat('Fn::Sub', '0'),
        },
      ];

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
      location: newLocation,
      rawValue: node.rawValue,
    } as ResourceNode;
  });
}

function generateTemplates(
  edges: ResourceEdge[],
  nodes: ResourceNode[],
  stackNames: string[],
  exports: Record<string, ScopedExport>,
  deployedStacks: CloudFormationStack[]): Record<string, CloudFormationTemplate> {
  updateReferences(edges, exports);
  const templates: Record<string, CloudFormationTemplate> = {};

  // Take the CloudFormation raw value of each the node and put it into the appropriate template.
  const allNodes = unique(edges.flatMap((e) => [e.source, ...e.targets]).concat(nodes));
  allNodes.forEach((node) => {
    const stackName = node.location.stack.stackName;
    const logicalId = node.location.logicalResourceId;

    if (templates[stackName] === undefined) {
      templates[stackName] = {
        Resources: {},
      };
    }
    templates[stackName].Resources![logicalId] = node.rawValue;
  });

  // Add outputs to the templates
  edges.forEach((edge) => {
    if (edge.reference instanceof ImportValue) {
      const stackName = edge.targets[0].location.stack.stackName;
      const template = templates[stackName];
      template.Outputs = {
        ...(template.Outputs ?? {}),
        ...edge.reference.output,
      };
    }
  });

  // The freshly generated templates contain only resources and outputs.
  // Combine them with the existing templates to preserve metadata and other properties.
  return Object.fromEntries(
    stackNames.map((stackName) => {
      const oldTemplate = deployedStacks.find((s) => s.stackName === stackName)?.template ?? {};
      const newTemplate = templates[stackName] ?? { Resources: {} };
      const combinedTemplate = { ...oldTemplate, ...newTemplate };

      sanitizeDependencies(combinedTemplate);
      return [stackName, combinedTemplate];
    }),
  );
}

/**
 * Update the CloudFormation resources based on information from the edges.
 * Each edge corresponds to a path in some resource object. The value at that
 * path is updated to the CloudFormation value represented by the edge's annotation.
 */
function updateReferences(edges: ResourceEdge[], exports: Record<string, ScopedExport>) {
  edges.forEach((edge) => {
    const cfnValue = edge.reference.toCfn(edge.targets, exports);
    const obj = edge.path.slice(0, edge.path.length - 1).reduce(getPropValue, edge.source.rawValue);
    setPropValue(obj, edge.path[edge.path.length - 1], cfnValue);
  });

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

        this.affectedStacks.add(newSourceStackName);
        this.affectedStacks.add(newTargetStackName);
        this.affectedStacks.add(oldSourceStackName);
        this.affectedStacks.add(oldTargetStackName);

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
          }
        }

        return {
          path: edge.path,
          source: newSource,
          targets: newTargets,
          reference,
        };
      })
      .filter((edge) => edge !== undefined);
  }

  get affectedStackNames(): string[] {
    const fromMappings = this.mappings.flatMap((m) => [m.source.stack.stackName, m.destination.stack.stackName]);
    return unique([...this.affectedStacks, ...fromMappings]);
  }

  private mapNode(node: ResourceNode): ResourceNode {
    const newLocation = mapLocation(node.location, this.mappings);
    const key = `${newLocation.stack.stackName}.${newLocation.logicalResourceId}`;
    if (!this.nodeMap.has(key)) {
      this.nodeMap.set(key, {
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

interface ResourceNode {
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
    const exp = this.findExport(targets, exports);
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
    // TODO better message
    throw new ToolkitError('Unknown export for ImportValue: ' + JSON.stringify(this.reference));
  }

  private findExport(targets: ResourceNode[], exports: Record<string, ScopedExport>) {
    const target = targets[0];
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

  get output(): Record<string, any> {
    if (this.outputName == null) {
      throw new ToolkitError('Cannot access output before calling toCfn');
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
      inputString = inputString.replace(`\${${varName}`, `\${${target.location.logicalResourceId}${attr ? `.${attr}` : ''}`,
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

/**
 * Interface for resolving CloudFormation references
 */
interface ReferenceResolver {
  resolveImportValue(exportName: string): Promise<any>;
  resolveRef(stackName: string, logicalId: string): Promise<string>;
  resolveGetAtt(stackName: string, logicalId: string, attributeName: string): Promise<any>;
}

/**
 * Implementation of ReferenceResolver that uses AWS APIs
 */
class AwsReferenceResolver implements ReferenceResolver {
  private readonly exportValueCache = new Map<string, any>();
  private readonly physicalIdCache = new Map<string, string>();
  private readonly attributeCache = new Map<string, any>();

  constructor(
    private readonly cfnClient: ICloudFormationClient,
    private readonly ccClient: ICloudControlClient,
  ) {}

  async resolveImportValue(exportName: string): Promise<any> {
    if (this.exportValueCache.has(exportName)) {
      return this.exportValueCache.get(exportName);
    }

    try {
      const result = await this.cfnClient.describeStacks({});
      const stacks = result.Stacks || [];
      
      for (const stack of stacks) {
        const outputs = stack.Outputs || [];
        for (const output of outputs) {
          if (output.ExportName === exportName) {
            const value = output.OutputValue;
            this.exportValueCache.set(exportName, value);
            return value;
          }
        }
      }
      
      throw new ToolkitError(`Export value not found: ${exportName}`);
    } catch (error) {
      throw new ToolkitError(`Failed to resolve import value ${exportName}: ${error}`);
    }
  }

  async resolveRef(stackName: string, logicalId: string): Promise<string> {
    const cacheKey = `${stackName}.${logicalId}`;
    if (this.physicalIdCache.has(cacheKey)) {
      return this.physicalIdCache.get(cacheKey)!;
    }

    try {
      const result = await this.cfnClient.describeStackResources({
        StackName: stackName,
        LogicalResourceId: logicalId,
      });

      const resource = result.StackResources?.[0];
      if (!resource?.PhysicalResourceId) {
        throw new ToolkitError(`Physical resource ID not found for ${stackName}.${logicalId}`);
      }

      this.physicalIdCache.set(cacheKey, resource.PhysicalResourceId);
      return resource.PhysicalResourceId;
    } catch (error) {
      throw new ToolkitError(`Failed to resolve Ref ${stackName}.${logicalId}: ${error}`);
    }
  }

  async resolveGetAtt(stackName: string, logicalId: string, attributeName: string): Promise<any> {
    const cacheKey = `${stackName}.${logicalId}.${attributeName}`;
    if (this.attributeCache.has(cacheKey)) {
      return this.attributeCache.get(cacheKey);
    }

    try {
      // First get the physical ID
      const physicalId = await this.resolveRef(stackName, logicalId);
      
      // Get the resource type from stack resources
      const stackResourcesResult = await this.cfnClient.describeStackResources({
        StackName: stackName,
        LogicalResourceId: logicalId,
      });

      const resource = stackResourcesResult.StackResources?.[0];
      if (!resource?.ResourceType) {
        throw new ToolkitError(`Resource type not found for ${stackName}.${logicalId}`);
      }

      // Use CloudControl API to get the resource and extract the attribute
      const ccResult = await this.ccClient.getResource({
        TypeName: resource.ResourceType,
        Identifier: physicalId,
      });

      if (!ccResult.ResourceDescription?.Properties) {
        throw new ToolkitError(`Resource properties not found for ${stackName}.${logicalId}`);
      }

      const properties = JSON.parse(ccResult.ResourceDescription.Properties);
      const attributeValue = this.extractAttribute(properties, attributeName);
      
      this.attributeCache.set(cacheKey, attributeValue);
      return attributeValue;
    } catch (error) {
      throw new ToolkitError(`Failed to resolve GetAtt ${stackName}.${logicalId}.${attributeName}: ${error}`);
    }
  }

  private extractAttribute(properties: any, attributeName: string): any {
    // Handle nested attribute names like "Arn" or "DomainEndpoint.DomainArn"
    const parts = attributeName.split('.');
    let current = properties;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        throw new ToolkitError(`Attribute ${attributeName} not found in resource properties`);
      }
    }
    
    return current;
  }
}

/**
 * Resolves all CloudFormation references in a list of stacks, replacing them with their actual values.
 * 
 * @param stacks - List of CloudFormationStack objects to process
 * @param cfnClient - CloudFormation client for API calls
 * @param ccClient - CloudControl client for API calls
 * @returns A new list of CloudFormationStack objects with resolved references
 */
export async function resolveCloudFormationReferences(
  stacks: CloudFormationStack[],
  cfnClient: ICloudFormationClient,
  ccClient: ICloudControlClient,
): Promise<CloudFormationStack[]> {
  const resolver = new AwsReferenceResolver(cfnClient, ccClient);
  
  const resolvedStacks: CloudFormationStack[] = [];
  
  for (const stack of stacks) {
    const resolvedTemplate = await resolveTemplateReferences(stack.template, resolver);
    
    resolvedStacks.push({
      environment: stack.environment,
      stackName: stack.stackName,
      template: resolvedTemplate,
    });
  }
  
  return resolvedStacks;
}

/**
 * Recursively resolves references in a CloudFormation template
 */
async function resolveTemplateReferences(
  template: CloudFormationTemplate,
  resolver: ReferenceResolver,
): Promise<CloudFormationTemplate> {
  const resolvedTemplate: CloudFormationTemplate = {
    Resources: {},
    Outputs: template.Outputs ? { ...template.Outputs } : undefined,
  };

  if (template.Resources) {
    for (const [logicalId, resource] of Object.entries(template.Resources)) {
      resolvedTemplate.Resources![logicalId] = await resolveValue(resource, resolver);
    }
  }

  if (template.Outputs) {
    const resolvedOutputs: Record<string, any> = {};
    for (const [outputName, output] of Object.entries(template.Outputs)) {
      resolvedOutputs[outputName] = await resolveValue(output, resolver);
    }
    resolvedTemplate.Outputs = resolvedOutputs;
  }

  return resolvedTemplate;
}

/**
 * Recursively resolves references in any CloudFormation value
 */
async function resolveValue(value: any, resolver: ReferenceResolver): Promise<any> {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const resolvedArray = [];
    for (const item of value) {
      resolvedArray.push(await resolveValue(item, resolver));
    }
    return resolvedArray;
  }

  if (typeof value === 'object') {
    // Handle CloudFormation intrinsic functions
    if ('Fn::ImportValue' in value) {
      const exportName = value['Fn::ImportValue'];
      if (typeof exportName === 'string') {
        return await resolver.resolveImportValue(exportName);
      } else {
        // The export name itself might be a reference that needs resolving
        const resolvedExportName = await resolveValue(exportName, resolver);
        return await resolver.resolveImportValue(resolvedExportName);
      }
    }

    if ('Ref' in value) {
      const logicalId = value.Ref;
      // For Ref, we need to determine the stack name. This is a limitation of the current approach.
      // In a real implementation, you'd need to pass stack context or handle this differently.
      // For now, we'll assume the reference is within the same stack being processed.
      throw new ToolkitError('Ref resolution requires stack context - this should be handled at a higher level');
    }

    if ('Fn::GetAtt' in value) {
      const getAtt = value['Fn::GetAtt'];
      let logicalId: string;
      let attributeName: string;
      
      if (typeof getAtt === 'string') {
        const parts = getAtt.split('.');
        logicalId = parts[0];
        attributeName = parts.slice(1).join('.');
      } else if (Array.isArray(getAtt) && getAtt.length === 2) {
        [logicalId, attributeName] = getAtt;
      } else {
        throw new ToolkitError(`Invalid Fn::GetAtt format: ${JSON.stringify(getAtt)}`);
      }
      
      // Same limitation as Ref - we need stack context
      throw new ToolkitError('Fn::GetAtt resolution requires stack context - this should be handled at a higher level');
    }

    // Handle other intrinsic functions by recursively resolving their parameters
    const resolvedObject: any = {};
    for (const [key, val] of Object.entries(value)) {
      resolvedObject[key] = await resolveValue(val, resolver);
    }
    return resolvedObject;
  }

  return value;
}

/**
 * Enhanced version that resolves references with proper stack context
 */
export async function resolveCloudFormationReferencesWithContext(
  stacks: CloudFormationStack[],
  cfnClient: ICloudFormationClient,
  ccClient: ICloudControlClient,
): Promise<CloudFormationStack[]> {
  const resolver = new AwsReferenceResolver(cfnClient, ccClient);
  
  const resolvedStacks: CloudFormationStack[] = [];
  
  for (const stack of stacks) {
    const resolvedTemplate = await resolveTemplateReferencesWithContext(
      stack.template,
      stack.stackName,
      resolver,
    );
    
    resolvedStacks.push({
      environment: stack.environment,
      stackName: stack.stackName,
      template: resolvedTemplate,
    });
  }
  
  return resolvedStacks;
}

/**
 * Resolves references in a template with stack context
 */
async function resolveTemplateReferencesWithContext(
  template: CloudFormationTemplate,
  stackName: string,
  resolver: ReferenceResolver,
): Promise<CloudFormationTemplate> {
  const resolvedTemplate: CloudFormationTemplate = {
    Resources: {},
    Outputs: template.Outputs ? { ...template.Outputs } : undefined,
  };

  if (template.Resources) {
    for (const [logicalId, resource] of Object.entries(template.Resources)) {
      resolvedTemplate.Resources![logicalId] = await resolveValueWithContext(
        resource,
        stackName,
        resolver,
      );
    }
  }

  if (template.Outputs) {
    const resolvedOutputs: Record<string, any> = {};
    for (const [outputName, output] of Object.entries(template.Outputs)) {
      resolvedOutputs[outputName] = await resolveValueWithContext(output, stackName, resolver);
    }
    resolvedTemplate.Outputs = resolvedOutputs;
  }

  return resolvedTemplate;
}

/**
 * Resolves references in any value with stack context
 */
async function resolveValueWithContext(
  value: any,
  stackName: string,
  resolver: ReferenceResolver,
): Promise<any> {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const resolvedArray = [];
    for (const item of value) {
      resolvedArray.push(await resolveValueWithContext(item, stackName, resolver));
    }
    return resolvedArray;
  }

  if (typeof value === 'object') {
    // Handle CloudFormation intrinsic functions
    if ('Fn::ImportValue' in value) {
      const exportName = value['Fn::ImportValue'];
      if (typeof exportName === 'string') {
        return await resolver.resolveImportValue(exportName);
      } else {
        const resolvedExportName = await resolveValueWithContext(exportName, stackName, resolver);
        return await resolver.resolveImportValue(resolvedExportName);
      }
    }

    if ('Ref' in value) {
      const logicalId = value.Ref;
      return await resolver.resolveRef(stackName, logicalId);
    }

    if ('Fn::GetAtt' in value) {
      const getAtt = value['Fn::GetAtt'];
      let logicalId: string;
      let attributeName: string;
      
      if (typeof getAtt === 'string') {
        const parts = getAtt.split('.');
        logicalId = parts[0];
        attributeName = parts.slice(1).join('.');
      } else if (Array.isArray(getAtt) && getAtt.length === 2) {
        [logicalId, attributeName] = getAtt;
      } else {
        throw new ToolkitError(`Invalid Fn::GetAtt format: ${JSON.stringify(getAtt)}`);
      }
      
      return await resolver.resolveGetAtt(stackName, logicalId, attributeName);
    }

    // Handle other intrinsic functions by recursively resolving their parameters
    const resolvedObject: any = {};
    for (const [key, val] of Object.entries(value)) {
      resolvedObject[key] = await resolveValueWithContext(val, stackName, resolver);
    }
    return resolvedObject;
  }

  return value;
}
