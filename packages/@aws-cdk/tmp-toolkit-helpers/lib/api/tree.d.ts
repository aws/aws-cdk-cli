import type { CloudAssembly } from '@aws-cdk/cx-api';
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
    readonly children?: {
        [key: string]: ConstructTreeNode;
    };
    readonly attributes?: {
        [key: string]: any;
    };
    /**
     * Information on the construct class that led to this node, if available
     */
    readonly constructInfo?: ConstructInfo;
}
/**
 * Whether the provided predicate is true for at least one element in the construct (sub-)tree.
 */
export declare function some(node: ConstructTreeNode | undefined, predicate: (n: ConstructTreeNode) => boolean): boolean;
export declare function loadTree(assembly: CloudAssembly, trace: (msg: string) => Promise<void>): Promise<ConstructTreeNode | undefined>;
export declare function loadTreeFromDir(outdir: string, trace: (msg: string) => void): ConstructTreeNode | undefined;
