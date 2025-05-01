import type * as cxapi from '@aws-cdk/cx-api';
import type { SDK } from '../aws-auth';
import type { IoHelper } from '../io/private';
export interface CloudWatchLogEventMonitorProps {
    /**
     * The IoHost used for messaging
     */
    readonly ioHelper: IoHelper;
    /**
     * The time from which we start reading log messages
     *
     * @default - now
     */
    readonly startTime?: Date;
}
export declare class CloudWatchLogEventMonitor {
    /**
     * Determines which events not to display
     */
    private startTime;
    /**
     * Map of environment (account:region) to LogGroupsAccessSettings
     */
    private readonly envsLogGroupsAccessSettings;
    /**
     * After reading events from all CloudWatch log groups
     * how long should we wait to read more events.
     *
     * If there is some error with reading events (i.e. Throttle)
     * then this is also how long we wait until we try again
     */
    private readonly pollingInterval;
    monitorId?: string;
    private readonly ioHelper;
    constructor(props: CloudWatchLogEventMonitorProps);
    /**
     * resume reading/printing events
     */
    activate(): Promise<void>;
    /**
     * deactivates the monitor so no new events are read
     * use case for this is when we are in the middle of performing a deployment
     * and don't want to interweave all the logs together with the CFN
     * deployment logs
     *
     * Also resets the start time to be when the new deployment was triggered
     * and clears the list of tracked log groups
     */
    deactivate(): Promise<void>;
    /**
     * Adds CloudWatch log groups to read log events from.
     * Since we could be watching multiple stacks that deploy to
     * multiple environments (account+region), we need to store a list of log groups
     * per env along with the SDK object that has access to read from
     * that environment.
     */
    addLogGroups(env: cxapi.Environment, sdk: SDK, logGroupNames: string[]): void;
    private logGroupNames;
    private scheduleNextTick;
    private tick;
    /**
     * Reads all new log events from a set of CloudWatch Log Groups
     * in parallel
     */
    private readNewEvents;
    /**
     * Print out a cloudwatch event
     */
    private print;
    /**
     * Reads all new log events from a CloudWatch Log Group
     * starting at either the time the hotswap was triggered or
     * when the last event was read on the previous tick
     */
    private readEventsFromLogGroup;
}
