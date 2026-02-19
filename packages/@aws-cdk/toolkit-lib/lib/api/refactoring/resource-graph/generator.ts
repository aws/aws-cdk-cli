import type { CloudFormationGraph } from './graph';
import type { CloudFormationTemplate, Resource, Output } from './types';
import { EdgeType } from './types';

export class CloudFormationGenerator {
  generate(
    graph: CloudFormationGraph,
    stackId?: string,
    metadata?: Partial<CloudFormationTemplate>,
  ): CloudFormationTemplate {
    const template: CloudFormationTemplate = {
      AWSTemplateFormatVersion: metadata?.AWSTemplateFormatVersion || '2010-09-09',
      Resources: {},
    };

    if (metadata?.Description) {
      template.Description = metadata.Description;
    }

    if (metadata?.Parameters) {
      template.Parameters = metadata.Parameters;
    }

    if (metadata?.Outputs) {
      template.Outputs = metadata.Outputs;
    }

    // Get nodes for this stack (or all if no stackId specified)
    const nodes = stackId ? graph.getNodesByStack(stackId) : graph.getAllNodes();

    // Generate resources from nodes
    for (const node of nodes) {
      const localId = this.getLocalId(node.id);

      // Transform properties to handle cross-stack references
      const transformedProperties = this.transformProperties(node.properties, node.id, graph);

      const resource: Resource = {
        Type: node.type,
        Properties: transformedProperties,
      };

      if (node.metadata) {
        const { CreationPolicy, DeletionPolicy, UpdatePolicy, UpdateReplacePolicy, ...otherMetadata } = node.metadata;

        if (Object.keys(otherMetadata).length > 0) {
          resource.Metadata = otherMetadata;
        }
        if (CreationPolicy) resource.CreationPolicy = CreationPolicy;
        if (DeletionPolicy) resource.DeletionPolicy = DeletionPolicy;
        if (UpdatePolicy) resource.UpdatePolicy = UpdatePolicy;
        if (UpdateReplacePolicy) resource.UpdateReplacePolicy = UpdateReplacePolicy;
      }

      // Add DependsOn from edges (only within same stack)
      const dependencies = graph
        .getEdges(node.id)
        .filter((edge) => edge.from === node.id && edge.type === EdgeType.DEPENDS_ON && !edge.crossStack)
        .map((edge) => this.getLocalId(edge.to));

      if (dependencies.length > 0) {
        resource.DependsOn = dependencies.length === 1 ? dependencies[0] : dependencies;
      }

      template.Resources[localId] = resource;
    }

    // Generate outputs from exports
    const exports = graph.getExports();
    for (const [exportName, exportInfo] of exports.entries()) {
      const resourceNode = graph.getNode(exportInfo.nodeId);
      if (resourceNode && resourceNode.stackId === stackId) {
        template.Outputs = template.Outputs || {};
        const localId = this.getLocalId(exportInfo.nodeId);
        const output: Output = {
          Value: { Ref: localId },
          Export: {
            Name: exportName,
          },
        };
        template.Outputs[exportInfo.outputId] = output;
      }
    }

    return template;
  }

  private transformProperties(
    properties: Record<string, any>,
    nodeId: string,
    graph: CloudFormationGraph,
  ): Record<string, any> {
    // Get all IMPORT_VALUE edges from this node
    const importEdges = graph
      .getEdges(nodeId)
      .filter((edge) => edge.from === nodeId && edge.type === EdgeType.IMPORT_VALUE);

    if (importEdges.length === 0) {
      return properties;
    }

    // Build a map of target node IDs to export names
    const importMap = new Map<string, string>();
    for (const edge of importEdges) {
      const targetResourceId = edge.to;
      const targetLogicalId = this.getLocalId(targetResourceId);

      // Find the export name for this resource
      for (const [exportName, { nodeId }] of graph.getExports().entries()) {
        if (nodeId === targetResourceId) {
          importMap.set(targetLogicalId, exportName);
          break;
        }
      }
    }

    // Transform Ref intrinsics to Fn::ImportValue
    return this.replaceRefs(properties, importMap);
  }

  private replaceRefs(obj: any, importMap: Map<string, string>): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceRefs(item, importMap));
    }

    // Check if this is a Ref that needs to be converted
    if (obj.Ref && typeof obj.Ref === 'string' && importMap.has(obj.Ref)) {
      return { 'Fn::ImportValue': importMap.get(obj.Ref) };
    }

    // Check if this is a Fn::GetAtt that needs to be converted
    if (obj['Fn::GetAtt']) {
      const target = Array.isArray(obj['Fn::GetAtt']) ? obj['Fn::GetAtt'][0] : obj['Fn::GetAtt'];

      if (typeof target === 'string' && importMap.has(target)) {
        // For GetAtt, we need to import the attribute
        // This is a simplification - in reality, the export would need to export the attribute
        return { 'Fn::ImportValue': importMap.get(target) };
      }
    }

    // Recursively process object properties
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.replaceRefs(value, importMap);
    }
    return result;
  }

  generateMultiple(graph: CloudFormationGraph): Map<string, CloudFormationTemplate> {
    const templates = new Map<string, CloudFormationTemplate>();

    for (const stackId of graph.getAllStacks()) {
      const template = this.generate(graph, stackId);
      templates.set(stackId, template);
    }

    return templates;
  }

  private getLocalId(qualifiedId: string): string {
    const parts = qualifiedId.split('.');
    return parts.length > 1 ? parts.slice(1).join('.') : qualifiedId;
  }
}
