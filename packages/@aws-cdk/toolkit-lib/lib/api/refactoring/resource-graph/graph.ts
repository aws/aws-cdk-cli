import type { GraphNode, GraphEdge, NodeLocation } from './types';
import { EdgeType } from './types';
import { ToolkitError } from '../../../toolkit/toolkit-error';

export class CloudFormationGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private exports: Map<string, { nodeId: string; outputId: string; value?: any }> = new Map(); // exportName -> { nodeId, outputId, value }

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.edges = this.edges.filter((edge) => edge.from !== id && edge.to !== id);

    // Remove from exports if it's an export node
    for (const [exportName, exportInfo] of this.exports.entries()) {
      if (exportInfo.nodeId === id) {
        this.exports.delete(exportName);
      }
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  getNodesByStack(stackId: string): GraphNode[] {
    return Array.from(this.nodes.values()).filter((node) => node.stackId === stackId);
  }

  addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new ToolkitError(`Cannot add edge: nodes ${edge.from} or ${edge.to} do not exist`);
    }
    this.edges.push(edge);
  }

  removeEdge(from: string, to: string): void {
    this.edges = this.edges.filter((edge) => !(edge.from === from && edge.to === to));
  }

  getEdges(nodeId?: string): GraphEdge[] {
    if (!nodeId) return [...this.edges];
    return this.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
  }

  getCrossStackEdges(): GraphEdge[] {
    return this.edges.filter((edge) => edge.crossStack);
  }

  getDependencies(nodeId: string): string[] {
    return this.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to);
  }

  getDependents(nodeId: string): string[] {
    return this.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
  }

  registerExport(exportName: string, nodeId: string, outputId?: string, value?: any): void {
    this.exports.set(exportName, { nodeId, outputId: outputId || this.getLogicalId(nodeId), value });
  }

  getExportNode(exportName: string): string | undefined {
    return this.exports.get(exportName)?.nodeId;
  }

  getExports(): Map<string, { nodeId: string; outputId: string; value?: any }> {
    return new Map(this.exports);
  }

  getAllStacks(): string[] {
    const stacks = new Set<string>();
    for (const node of this.nodes.values()) {
      if (node.stackId) {
        stacks.add(node.stackId);
      }
    }
    return Array.from(stacks);
  }

  moveNode(from: NodeLocation, to: NodeLocation): void {
    const currentId = this.getQualifiedId(from.stackId, from.logicalId);
    const node = this.nodes.get(currentId);
    if (!node) {
      throw new ToolkitError(`Node ${currentId} does not exist`);
    }

    const newQualifiedId = this.getQualifiedId(to.stackId, to.logicalId);

    // Check if target location already exists
    if (newQualifiedId !== currentId && this.nodes.has(newQualifiedId)) {
      throw new ToolkitError(`Target location ${newQualifiedId} already exists`);
    }

    // If the ID is the same, no move needed
    if (currentId === newQualifiedId) {
      return;
    }

    const isMovingAcrossStacks = from.stackId !== to.stackId;
    const oldLogicalId = from.logicalId;
    const newLogicalId = to.logicalId;

    // Create new node with updated location
    const movedNode: GraphNode = {
      ...node,
      id: newQualifiedId,
      stackId: to.stackId,
    };

    // Track edges that need to be converted to cross-stack references
    const edgesToConvert: Array<{ edge: GraphEdge; targetNode: GraphNode; targetStackId: string }> = [];
    const exportsToRemove = new Set<string>();
    const updatedEdges: GraphEdge[] = [];
    const edgesToRestore: GraphEdge[] = [];

    for (const edge of this.edges) {
      const updatedEdge = { ...edge };
      let shouldKeepEdge = true;

      if (edge.from === currentId) {
        updatedEdge.from = newQualifiedId;

        const toNode = this.nodes.get(edge.to);
        if (toNode && isMovingAcrossStacks) {
          if (toNode.stackId !== to.stackId) {
            // Moving to different stack than target - convert to cross-stack
            if (edge.type === EdgeType.DEPENDS_ON) {
              shouldKeepEdge = false;
            } else if (edge.type === EdgeType.REFERENCE || edge.type === EdgeType.GET_ATT) {
              edgesToConvert.push({ edge: updatedEdge, targetNode: toNode, targetStackId: toNode.stackId! });
              updatedEdge.type = EdgeType.IMPORT_VALUE;
              updatedEdge.crossStack = true;
              // Preserve attribute for GetAtt edges
              if (edge.type === EdgeType.GET_ATT && edge.attribute) {
                updatedEdge.attribute = edge.attribute;
              }
            }
          } else {
            // Moving to same stack as target - convert back to in-stack reference
            if (edge.type === EdgeType.IMPORT_VALUE) {
              updatedEdge.type = edge.attribute ? EdgeType.GET_ATT : EdgeType.REFERENCE;
              updatedEdge.crossStack = false;
              edgesToRestore.push({ from: newQualifiedId, to: edge.to, type: EdgeType.DEPENDS_ON });
              // Mark exports for removal if no other nodes use them
              for (const [exportName, exportInfo] of this.exports.entries()) {
                if (exportInfo.nodeId === edge.to) {
                  exportsToRemove.add(exportName);
                }
              }
            } else {
              updatedEdge.crossStack = false;
            }
            if (edge.type === EdgeType.REFERENCE || edge.type === EdgeType.GET_ATT) {
              edgesToRestore.push({ from: newQualifiedId, to: edge.to, type: EdgeType.DEPENDS_ON });
            }
          }
        }
      }

      if (edge.to === currentId) {
        updatedEdge.to = newQualifiedId;

        const fromNode = this.nodes.get(edge.from);
        if (fromNode && isMovingAcrossStacks) {
          if (fromNode.stackId !== to.stackId) {
            // Target moving to different stack - convert to cross-stack
            if (edge.type === EdgeType.DEPENDS_ON) {
              shouldKeepEdge = false;
            } else if (edge.type === EdgeType.REFERENCE || edge.type === EdgeType.GET_ATT) {
              // When the target moves, create export in the NEW stack (where target is moving to)
              const targetEdge = { ...edge, to: newQualifiedId };
              edgesToConvert.push({ edge: targetEdge, targetNode: movedNode, targetStackId: to.stackId });
              updatedEdge.type = EdgeType.IMPORT_VALUE;
              updatedEdge.crossStack = true;
              // Preserve attribute for GetAtt edges
              if (edge.type === EdgeType.GET_ATT && edge.attribute) {
                updatedEdge.attribute = edge.attribute;
              }
            }
          } else {
            // Target moving to same stack - convert back to in-stack reference
            if (edge.type === EdgeType.IMPORT_VALUE) {
              updatedEdge.type = edge.attribute ? EdgeType.GET_ATT : EdgeType.REFERENCE;
              updatedEdge.crossStack = false;
              // Mark exports for removal
              for (const [exportName, exportInfo] of this.exports.entries()) {
                if (exportInfo.nodeId === currentId) {
                  exportsToRemove.add(exportName);
                }
              }
            } else {
              updatedEdge.crossStack = false;
            }
            if (edge.type === EdgeType.REFERENCE || edge.type === EdgeType.GET_ATT) {
              edgesToRestore.push({ from: edge.from, to: newQualifiedId, type: EdgeType.DEPENDS_ON });
            }
          }
        }
      }

      if (shouldKeepEdge) {
        updatedEdges.push(updatedEdge);
      }
    }

    if (!isMovingAcrossStacks && oldLogicalId !== newLogicalId) {
      for (const [nodeId, n] of this.nodes.entries()) {
        if (nodeId !== currentId && n.stackId === from.stackId) {
          n.properties = this.updateReferencesInProperties(n.properties, oldLogicalId, newLogicalId);
        }
      }
    }

    const exportsToUpdate: Array<[string, { nodeId: string; outputId: string; value?: any }]> = [];
    for (const [exportName, exportInfo] of this.exports.entries()) {
      if (exportInfo.nodeId === currentId) {
        exportsToUpdate.push([
          exportName,
          { nodeId: newQualifiedId, outputId: exportInfo.outputId, value: exportInfo.value },
        ]);
      }
    }

    this.nodes.delete(currentId);
    this.nodes.set(newQualifiedId, movedNode);
    this.edges = updatedEdges;

    // Only remove exports if no other cross-stack edges reference them
    for (const exportName of exportsToRemove) {
      const exportInfo = this.exports.get(exportName);
      if (exportInfo) {
        const stillUsed = this.edges.some(
          (e) => e.type === EdgeType.IMPORT_VALUE && e.to === exportInfo.nodeId && e.crossStack,
        );
        if (!stillUsed) {
          this.exports.delete(exportName);
        }
      }
    }

    for (const [exportName, exportInfo] of exportsToUpdate) {
      this.exports.set(exportName, exportInfo);
    }

    for (const edge of edgesToRestore) {
      if (!this.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === EdgeType.DEPENDS_ON)) {
        this.edges.push(edge);
      }
    }

    if (isMovingAcrossStacks && edgesToConvert.length > 0) {
      this.convertReferencesToImports(edgesToConvert);
    }
  }

  private updateReferencesInProperties(obj: any, oldLogicalId: string, newLogicalId: string): any {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.updateReferencesInProperties(item, oldLogicalId, newLogicalId));
    }

    // Update Ref intrinsic
    if (obj.Ref === oldLogicalId) {
      return { Ref: newLogicalId };
    }

    // Update Fn::GetAtt intrinsic
    if (obj['Fn::GetAtt']) {
      const attr = obj['Fn::GetAtt'];
      if (Array.isArray(attr) && attr[0] === oldLogicalId) {
        return { 'Fn::GetAtt': [newLogicalId, ...attr.slice(1)] };
      }
    }

    // Recursively process object properties
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.updateReferencesInProperties(value, oldLogicalId, newLogicalId);
    }
    return result;
  }

  private convertReferencesToImports(
    edgesToConvert: Array<{ edge: GraphEdge; targetNode: GraphNode; targetStackId: string }>,
  ): void {
    // Group edges by target node and attribute to handle multiple references
    const edgesByTargetAndAttr = new Map<
      string,
      Array<{ edge: GraphEdge; targetNode: GraphNode; targetStackId: string }>
    >();

    for (const item of edgesToConvert) {
      const key = item.edge.attribute ? `${item.targetNode.id}::${item.edge.attribute}` : item.targetNode.id;
      const existing = edgesByTargetAndAttr.get(key) || [];
      existing.push(item);
      edgesByTargetAndAttr.set(key, existing);
    }

    for (const edges of edgesByTargetAndAttr.values()) {
      const targetNode = edges[0].targetNode;
      const targetStackId = edges[0].targetStackId;
      const targetLogicalId = this.getLogicalId(targetNode.id);
      const attribute = edges[0].edge.attribute;

      // Check if an export already exists for this target and attribute combination
      let existingExportName: string | undefined;
      for (const [exportName, exportInfo] of this.exports.entries()) {
        if (exportInfo.nodeId === targetNode.id) {
          // Check if the export value matches what we need
          if (attribute && exportInfo.value?.['Fn::GetAtt']?.[1] === attribute) {
            existingExportName = exportName;
            break;
          } else if (!attribute && exportInfo.value?.Ref) {
            existingExportName = exportName;
            break;
          }
        }
      }

      if (!existingExportName) {
        // Create export value based on edge type
        let exportValue: any;
        let exportSuffix = targetLogicalId;

        if (attribute) {
          exportValue = { 'Fn::GetAtt': [targetLogicalId, attribute] };
          exportSuffix = `${targetLogicalId}-${attribute}`;
        } else {
          exportValue = { Ref: targetLogicalId };
        }

        const exportName = `${targetStackId}-${exportSuffix}`;
        this.exports.set(exportName, { nodeId: targetNode.id, outputId: targetLogicalId, value: exportValue });
      }
    }
  }

  private getQualifiedId(stackId: string, logicalId: string): string {
    return `${stackId}.${logicalId}`;
  }

  getStackId(qualifiedId: string): string | undefined {
    const node = this.nodes.get(qualifiedId);
    return node?.stackId;
  }

  getLogicalId(qualifiedId: string): string {
    const parts = qualifiedId.split('.');
    return parts.length > 1 ? parts.slice(1).join('.') : qualifiedId;
  }

  /**
   * Returns all nodes in topologically sorted order based on their dependencies.
   * If a circular dependency is detected, an error is thrown.
   */
  getAllNodesSorted(): GraphNode[] {
    const visited = new Set<string>();
    const temp = new Set<string>();
    const result: string[] = [];

    const visit = (nodeId: string): void => {
      if (temp.has(nodeId)) {
        throw new ToolkitError('Circular dependency detected');
      }
      if (visited.has(nodeId)) return;

      temp.add(nodeId);
      const deps = this.getDependencies(nodeId);
      for (const dep of deps) {
        visit(dep);
      }
      temp.delete(nodeId);
      visited.add(nodeId);
      result.push(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        visit(nodeId);
      }
    }

    return result.map((id) => this.nodes.get(id)!);
  }

  /**
   * Returns a copy of this graph with all edge directions reversed.
   */
  opposite(): CloudFormationGraph {
    const reversed = new CloudFormationGraph();

    reversed.nodes = this.nodes;

    for (const edge of this.edges) {
      reversed.edges.push({ ...edge, from: edge.to, to: edge.from });
    }

    for (const [exportName, exportInfo] of this.exports.entries()) {
      reversed.exports.set(exportName, exportInfo);
    }

    return reversed;
  }
}
