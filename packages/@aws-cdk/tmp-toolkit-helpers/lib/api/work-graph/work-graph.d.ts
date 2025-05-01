import type { WorkNode, StackNode, AssetBuildNode, AssetPublishNode } from './work-graph-types';
import { type IoHelper } from '../io/private';
export type Concurrency = number | Record<WorkNode['type'], number>;
export declare class WorkGraph {
    readonly nodes: Record<string, WorkNode>;
    private readonly readyPool;
    private readonly lazyDependencies;
    private readonly ioHelper;
    error?: Error;
    constructor(nodes: Record<string, WorkNode>, ioHelper: IoHelper);
    addNodes(...nodes: WorkNode[]): void;
    removeNode(nodeId: string | WorkNode): void;
    /**
     * Return all nodes of a given type
     */
    nodesOfType<T extends WorkNode['type']>(type: T): Extract<WorkNode, {
        type: T;
    }>[];
    /**
     * Return all nodes that depend on a given node
     */
    dependees(nodeId: string | WorkNode): WorkNode[];
    /**
     * Add a dependency, that may come before or after the nodes involved
     */
    addDependency(fromId: string, toId: string): void;
    tryGetNode(id: string): WorkNode | undefined;
    node(id: string): WorkNode;
    absorb(graph: WorkGraph): void;
    private hasFailed;
    doParallel(concurrency: Concurrency, actions: WorkGraphActions): Promise<void>;
    /**
     * Return the set of unblocked nodes
     */
    ready(): Promise<ReadonlyArray<WorkNode>>;
    private forAllArtifacts;
    private done;
    private deployed;
    private failed;
    toString(): string;
    /**
     * Ensure all dependencies actually exist. This protects against scenarios such as the following:
     * StackA depends on StackB, but StackB is not selected to deploy. The dependency is redundant
     * and will be dropped.
     * This assumes the manifest comes uncorrupted so we will not fail if a dependency is not found.
     */
    removeUnavailableDependencies(): void;
    /**
     * Remove all asset publishing steps for assets that are already published, and then build
     * that aren't used anymore.
     *
     * Do this in parallel, because there may be a lot of assets in an application (seen in practice: >100 assets)
     */
    removeUnnecessaryAssets(isUnnecessary: (x: AssetPublishNode) => Promise<boolean>): Promise<void>;
    private updateReadyPool;
    private skipRest;
    /**
     * Find cycles in a graph
     *
     * Not the fastest, but effective and should be rare
     */
    findCycle(): string[] | undefined;
    /**
     * Whether the `end` node is reachable from the `start` node, following the dependency arrows
     */
    reachable(start: string, end: string): boolean;
}
export interface WorkGraphActions {
    deployStack: (stackNode: StackNode) => Promise<void>;
    buildAsset: (assetNode: AssetBuildNode) => Promise<void>;
    publishAsset: (assetNode: AssetPublishNode) => Promise<void>;
}
