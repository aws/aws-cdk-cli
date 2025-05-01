import * as cxapi from '@aws-cdk/cx-api';
import { WorkGraph } from './work-graph';
import type { WorkNode } from './work-graph-types';
import type { IoHelper } from '../io/private';
export declare class WorkGraphBuilder {
    private readonly prebuildAssets;
    private readonly idPrefix;
    /**
     * Default priorities for nodes
     *
     * Assets builds have higher priority than the other two operations, to make good on our promise that
     * '--prebuild-assets' will actually do assets before stacks (if it can). Unfortunately it is the
     * default :(
     *
     * But between stack dependencies and publish dependencies, stack dependencies go first
     */
    static PRIORITIES: Record<WorkNode['type'], number>;
    private readonly graph;
    private readonly ioHelper;
    constructor(ioHelper: IoHelper, prebuildAssets: boolean, idPrefix?: string);
    private addStack;
    /**
     * Oof, see this parameter list
     */
    private addAsset;
    build(artifacts: cxapi.CloudArtifact[]): WorkGraph;
    private stackArtifactIds;
    private stackArtifactId;
    /**
     * We may have accidentally introduced cycles in an attempt to make the messages printed to the
     * console not interfere with each other too much. Remove them again.
     */
    private removeStackPublishCycles;
}
