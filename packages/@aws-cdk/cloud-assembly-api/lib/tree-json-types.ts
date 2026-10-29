/**
 * Serializable representation of a construct
 */
export interface Node<Child> {
  /**
   * The construct's ID
   *
   * Even though this ID is already in the `children` map of the containing node,
   * we repeat it here.
   */
  readonly id: string;

  /**
   * The construct's path
   *
   * Even though this path can be constructed from the construct IDs of constructs
   * on the root path to this construct, we still repeat it here.
   *
   * FIXME: In a sizeable file (tested on 136MB) this takes about 20% of the
   * total size without adding any value. We should probably remove this at some
   * point.
   */
  readonly path: string;
  children?: { [key: string]: Child };
  attributes?: { [key: string]: unknown };

  /**
   * Information on the construct class that led to this node, if available
   */
  constructInfo?: ConstructInfo;
}

export interface TreeFile {
  version: 'tree-0.1';
  tree: TreeFileNode;
}

export interface ForestFile {
  version: 'forest-0.1';
  forest: Record<string, TreeFileNode>;
}

export type TreeFileNode = Node<TreeFileNode> | SubTreeReference;

export type TreeNode = Node<TreeNode>;

/**
 * A reference to a node that is stored in an entirely different tree.json file
 */
export interface SubTreeReference {
  readonly id: string;
  readonly path: string;
  fileName: string;

  /**
   * If set, indicates the subtree in the forest file
   *
   * If this is set then `fileName` must point to a ForestFile, and this indicates
   * the tree inside the forest.
   */
  treeId: string;
}

/**
 * Source information on a construct (class fqn and version)
 */
export interface ConstructInfo {
  // !!! Important !!!
  // This is the public contract of what shows up in tree.json
  // We are very unlikely to extend this in future
  // I you need additional details, add them on top of this.

  /**
   * The FQN of the construct.
   */
  readonly fqn: string;
  /**
   * The version of the package the construct belongs to.
   */
  readonly version: string;
}

export function isSubtreeReference(x: TreeFileNode): x is SubTreeReference {
  return (x as SubTreeReference).fileName !== undefined && !!(x as SubTreeReference).treeId;
}
