import * as path from 'node:path';
import type { CloudAssembly } from '@aws-cdk/cloud-assembly-api';
import * as fs from 'fs-extra';

/**
 * Source information on a construct (class fqn and version)
 */
export interface ConstructInfo {
  readonly fqn: string;
  readonly version: string;
}

/**
 * A node in the construct tree.
 */
export interface ConstructTreeNode {
  readonly id: string;
  readonly path: string;
  readonly children?: { [key: string]: ConstructTreeNode };
  readonly attributes?: { [key: string]: any };

  /**
   * Information on the construct class that led to this node, if available
   */
  readonly constructInfo?: ConstructInfo;
}

/**
 * Whether the provided predicate is true for at least one element in the construct (sub-)tree.
 */
export function some(node: ConstructTreeNode | undefined, predicate: (n: ConstructTreeNode) => boolean): boolean {
  return node != null && (predicate(node) || findInChildren());

  function findInChildren(): boolean {
    return Object.values(node?.children ?? {}).some(child => some(child, predicate));
  }
}

export async function loadTree(assembly: CloudAssembly, trace: (msg: string) => Promise<void>): Promise<ConstructTreeNode | undefined> {
  try {
    const outdir = assembly.directory;
    const fileName = assembly.tree()?.file;
    return fileName ? fs.readJSONSync(path.join(outdir, fileName)).tree : undefined;
  } catch (e) {
    await trace(`Failed to get tree.json file: ${e}. Proceeding with empty tree.`);
    return undefined;
  }
}

export async function loadTreeFromDir(outdir: string, trace: (msg: string) => Promise<void>): Promise<ConstructTreeNode | undefined> {
  try {
    return fs.readJSONSync(path.join(outdir, 'tree.json')).tree;
  } catch (e) {
    await trace(`Failed to get tree.json file: ${e}. Proceeding with empty tree.`);
    return undefined;
  }
}
