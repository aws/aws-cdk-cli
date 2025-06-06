import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import type { CloudFormationStack, CloudFormationTemplate, ResourceMapping } from './cloudformation';
import { ResourceLocation } from './cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';

interface ScopedExport {
  stackName: string;
  outputName: string;
  value: any;
}

interface ResourceNode {
  location: ResourceLocation;
  rawValue: any;
}

interface ResourceMultiEdge {
  source: ResourceNode;
  targets: ResourceNode[];
  path: string[];
  annotation: CloudFormationReference;
}

interface CloudFormationReference {
  readonly isCrossStack: boolean;

  toCfn(targets: ResourceNode[], exports: Record<string, ScopedExport>): any;
}

class Ref implements CloudFormationReference {
  isCrossStack = false;

  toCfn(targets: ResourceNode[]): any {
    return { Ref: targets[0].location.logicalResourceId };
  }
}

class GetAtt implements CloudFormationReference {
  isCrossStack = false;

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
  isCrossStack = true;

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
  isCrossStack = false;

  constructor(public readonly inputString: string) {
  }

  toCfn(targets: ResourceNode[]): any {
    const regex = /\${([a-zA-Z0-9_.]+)}/;
    let inputString = this.inputString;
    targets.forEach((t) => {
      const variable = inputString.match(regex)![1];
      const [_, attr] = variable.split(/\.(.*)/s);
      const toReplace = attr ? `${t.location.logicalResourceId}.${attr}` : t.location.logicalResourceId;
      inputString = inputString.replace(regex, toReplace);
    });

    return { 'Fn::Sub': inputString };
  }
}

class DependsOn implements CloudFormationReference {
  isCrossStack = false;

  toCfn(targets: ResourceNode[]): any {
    return { DependsOn: targets.map((t) => t.location.logicalResourceId) };
  }
}

// TODO rename this
export function generateStackDefinitionsReloaded(
  mappings: ResourceMapping[],
  deployedStacks: CloudFormationStack[],
  localStacks: CloudFormationStack[],
): StackDefinition[] {
  const localExports: Record<string, ScopedExport> = indexExports(localStacks);
  const deployedExports: Record<string, ScopedExport> = indexExports(deployedStacks);
  const deployedNodeMap: Map<string, ResourceNode> = buildNodes(deployedStacks);
  const deployedNodes = Array.from(deployedNodeMap.values());

  const oldEdges = buildEdges(deployedNodeMap, deployedExports);

  const isolatedNodes = deployedNodes.filter(node => {
    return !oldEdges.some(edge => edge.source.location.equalTo(node.location)
      || edge.targets.some(target => target.location.equalTo(node.location)));
  });

  const nodes = isolatedNodes.map(node => {
    const newLocation = mapLocation(node.location, mappings);
    return {
      location: newLocation,
      rawValue: node.rawValue,
    } as ResourceNode;
  });

  const edgeMapper = new EdgeMapper(mappings);
  const edges = edgeMapper.mapEdges(oldEdges);

  // CloudFormation stuff from here on
  updateReferences(edges, localExports);

  const allNodes = Array.from(new Set(edges.flatMap(e => [e.source, ...e.targets]))).concat(nodes);

  const templates: Record<string, CloudFormationTemplate> = {};
  allNodes.forEach(node => {
    const stackName = node.location.stack.stackName;
    const logicalId = node.location.logicalResourceId;

    if (templates[stackName] === undefined) {
      templates[stackName] = {
        Resources: {},
      };
    }
    templates[stackName].Resources![logicalId] = node.rawValue;
  });

  // The existence of an ImportValue edge means that the output of the target stack
  edges.forEach(edge => {
    if (edge.annotation instanceof ImportValue) {
      const stackName = edge.targets[0].location.stack.stackName;
      const template = templates[stackName];
      template.Outputs = {
        ...(template.Outputs ?? {}),
        ...edge.annotation.output,
      };
    }
  });

  const stackNamesFromMappings = mappings.flatMap(m => [m.source.stack.stackName, m.destination.stack.stackName]);
  const affectedStackNames = unique([...edgeMapper.affectedStacks, ...stackNamesFromMappings]);

  return affectedStackNames.map((stackName) => {
    const oldTemplate = deployedStacks.find(s => s.stackName === stackName)?.template ?? {};
    const newTemplate = templates[stackName] ?? { Resources: {} };
    const combinedTemplate = { ...oldTemplate, ...newTemplate };

    sanitizeDependencies(combinedTemplate);
    return {
      StackName: stackName,
      TemplateBody: JSON.stringify(combinedTemplate),
    } as StackDefinition;
  });
}

/**
 * Update the CloudFormation resources based on information from the edges.
 * Each edge corresponds to a path in some resource object. The value at that
 * path is updated to the CloudFormation value represented by the edge's annotation.
 */
function updateReferences(edges: ResourceMultiEdge[], exports: Record<string, ScopedExport>) {
  edges.forEach((edge) => {
    const cfnValue = edge.annotation.toCfn(edge.targets, exports);
    const obj = edge.path
      .slice(0, edge.path.length - 1)
      .reduce(getPropValue, edge.source.rawValue);
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

  mapEdges(edges: ResourceMultiEdge[]): ResourceMultiEdge[] {
    return edges.map((edge) => {
      const oldSource = edge.source;
      const oldTargets = edge.targets;
      const newSource = this.mapNode(oldSource);
      const newTargets = oldTargets.map(t => this.mapNode(t));

      const oldSourceStackName = oldSource.location.stack.stackName;
      const oldTargetStackName = oldTargets[0].location.stack.stackName;

      const newSourceStackName = newSource.location.stack.stackName;
      const newTargetStackName = newTargets[0].location.stack.stackName;

      this.affectedStacks.add(newSourceStackName);
      this.affectedStacks.add(newTargetStackName);
      this.affectedStacks.add(oldSourceStackName);
      this.affectedStacks.add(oldTargetStackName);

      let annotation: CloudFormationReference = edge.annotation;
      if (oldSourceStackName === oldTargetStackName && newSourceStackName !== newTargetStackName) {
        if (edge.annotation instanceof DependsOn) {
          return undefined;
        }

        // in-stack reference to cross-stack reference: wrap the old annotation
        annotation = new ImportValue(edge.annotation);
      } else if (oldSourceStackName !== oldTargetStackName && newSourceStackName === newTargetStackName) {
        // cross-stack reference to in-stack reference: unwrap the old annotation
        if (edge.annotation instanceof ImportValue) {
          annotation = edge.annotation.reference;
        }
      }

      return {
        path: edge.path,
        source: newSource,
        targets: newTargets,
        annotation,
      };
    }).filter((edge) => edge !== undefined);
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
): ResourceMultiEdge[] {
  const nodes = Array.from(nodeMap.values());
  return nodes.flatMap((node) => buildEdgesForResource(node, node.rawValue));

  function buildEdgesForResource(source: ResourceNode, value: any, path: string[] = []): ResourceMultiEdge[] {
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
            annotation: new ImportValue(new Ref()),
          },
        ];
      }

      if ('Fn::GetAtt' in x.value) {
        const getAtt = makeGetAtt(x.stackName, x.value['Fn::GetAtt']);
        return [
          {
            ...getAtt,
            annotation: new ImportValue(getAtt.annotation),
          },
        ];
      }

      // TODO handle other cases?
      return [];
    }

    if ('Fn::Sub' in value) {
      let inputString: string;
      let variables: Record<string, any> | undefined;
      if (typeof value['Fn::Sub'] === 'string') {
        inputString = value['Fn::Sub'];
      } else {
        [inputString, variables] = value['Fn::Sub'];
      }

      const edges = Array.from(inputString.matchAll(/\${([a-zA-Z0-9_.]+)}/g))
        .map((x) => x[1])
        .map((varName) => {
          return varName.includes('.')
            ? makeGetAtt(source.location.stack.stackName, varName)
            : makeRef(source.location.stack.stackName, varName);
        });

      const edgesFromInputString = [
        {
          source,
          targets: edges.flatMap((edge) => edge.targets),
          annotation: new Sub(inputString),
          path: path.concat('Fn::Sub', '0'),
        },
      ];

      const edgesFromVariables = buildEdgesForResource(source, variables, path.concat('Fn::Sub', '1'));

      return [...edgesFromInputString, ...edgesFromVariables];
    }

    const edges: ResourceMultiEdge[] = [];

    // DependsOn is only handled at the top level of the resource
    if ('DependsOn' in value && path.length === 0) {
      if (typeof value.DependsOn === 'string') {
        edges.push({
          ...makeRef(source.location.stack.stackName, value.DependsOn),
          annotation: new DependsOn(),
        });
      } else if (Array.isArray(value.DependsOn)) {
        edges.push({
          source,
          targets: value.DependsOn.flatMap(
            (dependsOn: string) => makeRef(source.location.stack.stackName, dependsOn).targets,
          ),
          path,
          annotation: new DependsOn(),
        });
      }
    }

    edges.push(...Object.entries(value).flatMap(([k, v]) => buildEdgesForResource(source, v, path.concat(k))));

    return edges;

    function makeRef(stackName: string, logicalId: string): ResourceMultiEdge {
      const key = `${stackName}.${logicalId}`;
      const target = nodeMap.get(key)!;

      return {
        path,
        source,
        targets: [target],
        annotation: new Ref(), // TODO can be a singleton
      };
    }

    function makeGetAtt(stackName: string, att: string | string[]): ResourceMultiEdge {
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
        annotation: new GetAtt(attributeName),
      };
    }
  }
}

function indexExports(stacks: CloudFormationStack[]): Record<string, ScopedExport> {
  return Object.fromEntries(
    stacks.flatMap((s) =>
      Object.entries(s.template.Outputs ?? {})
        .filter(([_, o]) => typeof o.Export?.Name === 'string' && (o.Value.Ref != null || o.Value['Fn::GetAtt'] != null))
        .map(([name, o]) => [o.Export.Name, { stackName: s.stackName, outputName: name, value: o.Value }]),
    ),
  );
}

function unique<T>(arr: Array<T>) {
  return Array.from(new Set(arr));
}

/**
 * Updates the DependsOn property of all resources, removing references
 * to resources that do not exist in the template. If a resource's
 * DependsOn property ends up empty or undefined, it is removed.
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
