import type { StackEvent } from '@aws-sdk/client-cloudformation';
import type { ICloudFormationClient } from '../aws-auth';
export interface StackEventPollerProps {
    /**
     * The stack to poll
     */
    readonly stackName: string;
    /**
     * IDs of parent stacks of this resource, in case of resources in nested stacks
     */
    readonly parentStackLogicalIds?: string[];
    /**
     * Timestamp for the oldest event we're interested in
     *
     * @default - Read all events
     */
    readonly startTime?: number;
    /**
     * Stop reading when we see the stack entering this status
     *
     * Should be something like `CREATE_IN_PROGRESS`, `UPDATE_IN_PROGRESS`,
     * `DELETE_IN_PROGRESS, `ROLLBACK_IN_PROGRESS`.
     *
     * @default - Read all events
     */
    readonly stackStatuses?: string[];
}
export interface ResourceEvent {
    /**
     * The Stack Event as received from CloudFormation
     */
    readonly event: StackEvent;
    /**
     * IDs of parent stacks of the resource, in case of resources in nested stacks
     */
    readonly parentStackLogicalIds: string[];
    /**
     * Whether this event regards the root stack
     *
     * @default false
     */
    readonly isStackEvent?: boolean;
}
export declare class StackEventPoller {
    private readonly cfn;
    private readonly props;
    readonly events: ResourceEvent[];
    complete: boolean;
    private readonly eventIds;
    private readonly nestedStackPollers;
    constructor(cfn: ICloudFormationClient, props: StackEventPollerProps);
    /**
     * From all accumulated events, return only the errors
     */
    get resourceErrors(): ResourceEvent[];
    /**
     * Poll for new stack events
     *
     * Will not return events older than events indicated by the constructor filters.
     *
     * Recurses into nested stacks, and returns events old-to-new.
     */
    poll(): Promise<ResourceEvent[]>;
    private doPoll;
    /**
     * On the CREATE_IN_PROGRESS, UPDATE_IN_PROGRESS, DELETE_IN_PROGRESS event of a nested stack, poll the nested stack updates
     */
    private trackNestedStack;
}
