import type { GraphNode, GraphEdge, NodeLocation } from './types';
import { EdgeType } from './types';
import { ToolkitError } from '../../../toolkit/toolkit-error';

export class CloudFormationGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private exports: Map<string, { nodeId: string; outputId: string }> = new Map(); // exportName -> { nodeId, outputId }

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

  registerExport(exportName: string, nodeId: string, outputId?: string): void {
    this.exports.set(exportName, { nodeId, outputId: outputId || this.getLogicalId(nodeId) });
  }

  getExportNode(exportName: string): string | undefined {
    return this.exports.get(exportName)?.nodeId;
  }

  getExports(): Map<string, { nodeId: string; outputId: string }> {
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
    const edgesToConvert: Array<{ edge: GraphEdge; targetNode: GraphNode }> = [];

    // Update edges to point to new ID
    const updatedEdges: GraphEdge[] = [];
    for (const edge of this.edges) {
      const updatedEdge = { ...edge };
      let shouldKeepEdge = true;

      if (edge.from === currentId) {
        updatedEdge.from = newQualifiedId;

        const toNode = this.nodes.get(edge.to);
        if (toNode && isMovingAcrossStacks && toNode.stackId !== to.stackId) {
          if (edge.type === EdgeType.DEPENDS_ON) {
            shouldKeepEdge = false;
          } else if (edge.type === EdgeType.REFERENCE || edge.type === EdgeType.GET_ATT) {
            edgesToConvert.push({ edge, targetNode: toNode });
            updatedEdge.type = EdgeType.IMPORT_VALUE;
          }
          updatedEdge.crossStack = true;
        }
      }

      if (edge.to === currentId) {
        updatedEdge.to = newQualifiedId;

        const fromNode = this.nodes.get(edge.from);
        if (fromNode && isMovingAcrossStacks && fromNode.stackId !== to.stackId) {
          if (edge.type === EdgeType.DEPENDS_ON) {
            shouldKeepEdge = false;
          } else if (edge.type === EdgeType.REFERENCE || edge.type === EdgeType.GET_ATT) {
            edgesToConvert.push({ edge, targetNode: movedNode });
            updatedEdge.type = EdgeType.IMPORT_VALUE;
          }
          updatedEdge.crossStack = true;
        }
      }

      if (shouldKeepEdge) {
        updatedEdges.push(updatedEdge);
      }
    }

    // Update properties in nodes that reference the moved node (within same stack)
    if (!isMovingAcrossStacks && oldLogicalId !== newLogicalId) {
      for (const [nodeId, n] of this.nodes.entries()) {
        if (nodeId !== currentId && n.stackId === from.stackId) {
          n.properties = this.updateReferencesInProperties(n.properties, oldLogicalId, newLogicalId);
        }
      }
    }

    // Update exports if this node is exported
    const exportsToUpdate: Array<[string, { nodeId: string; outputId: string }]> = [];
    for (const [exportName, exportInfo] of this.exports.entries()) {
      if (exportInfo.nodeId === currentId) {
        exportsToUpdate.push([exportName, { nodeId: newQualifiedId, outputId: exportInfo.outputId }]);
      }
    }

    // Apply all changes
    this.nodes.delete(currentId);
    this.nodes.set(newQualifiedId, movedNode);
    this.edges = updatedEdges;

    for (const [exportName, exportInfo] of exportsToUpdate) {
      this.exports.set(exportName, exportInfo);
    }

    // Convert in-stack references to cross-stack imports
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
    edgesToConvert: Array<{ edge: GraphEdge; targetNode: GraphNode }>,
  ): void {
    for (const { targetNode } of edgesToConvert) {
      // Check if an export already exists for this target
      let exportName: string | undefined;

      for (const [name, exportInfo] of this.exports.entries()) {
        if (exportInfo.nodeId === targetNode.id) {
          exportName = name;
          break;
        }
      }

      // If no export exists, create one
      if (!exportName) {
        const targetLogicalId = this.getLogicalId(targetNode.id);
        exportName = `${targetNode.stackId}-${targetLogicalId}`;
        this.exports.set(exportName, { nodeId: targetNode.id, outputId: targetLogicalId });
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
