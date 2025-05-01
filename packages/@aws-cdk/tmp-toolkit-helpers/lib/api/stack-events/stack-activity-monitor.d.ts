import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { ICloudFormationClient } from '../aws-auth';
import { type IoHelper } from '../io/private';
export interface StackActivityMonitorProps {
    /**
     * The CloudFormation client
     */
    readonly cfn: ICloudFormationClient;
    /**
     * The IoHelper used for messaging
     */
    readonly ioHelper: IoHelper;
    /**
     * The stack artifact that is getting deployed
     */
    readonly stack: CloudFormationStackArtifact;
    /**
     * The name of the Stack that is getting deployed
     */
    readonly stackName: string;
    /**
     * Total number of resources to update
     *
     * Used to calculate a progress bar.
     *
     * @default - No progress reporting.
     */
    readonly resourcesTotal?: number;
    /**
     * Creation time of the change set
     *
     * This will be used to filter events, only showing those from after the change
     * set creation time.
     *
     * It is recommended to use this, otherwise the filtering will be subject
     * to clock drift between local and cloud machines.
     *
     * @default - local machine's current time
     */
    readonly changeSetCreationTime?: Date;
    /**
     * Time to wait between fetching new activities.
     *
     * Must wait a reasonable amount of time between polls, since we need to consider CloudFormation API limits
     *
     * @default 2_000
     */
    readonly pollingInterval?: number;
}
export declare class StackActivityMonitor {
    /**
     * The poller used to read stack events
     */
    private readonly poller;
    /**
     * Fetch new activity every 1 second
     * Printers can decide to update a view less frequently if desired
     */
    private readonly pollingInterval;
    readonly errors: string[];
    private monitorId?;
    private readonly progressMonitor;
    /**
     * Current tick timer
     */
    private tickTimer?;
    /**
     * Set to the activity of reading the current events
     */
    private readPromise?;
    private readonly ioHelper;
    private readonly stackName;
    private readonly stack;
    constructor({ cfn, ioHelper, stack, stackName, resourcesTotal, changeSetCreationTime, pollingInterval, }: StackActivityMonitorProps);
    start(): Promise<this>;
    stop(): Promise<void>;
    private scheduleNextTick;
    private tick;
    private findMetadataFor;
    /**
     * Reads all new events from the stack history
     *
     * The events are returned in reverse chronological order; we continue to the next page if we
     * see a next page and the last event in the page is new to us (and within the time window).
     * haven't seen the final event
     */
    private readNewEvents;
    /**
     * Perform a final poll to the end and flush out all events to the printer
     *
     * Finish any poll currently in progress, then do a final one until we've
     * reached the last page.
     */
    private finalPollToEnd;
    /**
     * Formats a stack activity into a basic string
     */
    private formatActivity;
    private checkForErrors;
}
