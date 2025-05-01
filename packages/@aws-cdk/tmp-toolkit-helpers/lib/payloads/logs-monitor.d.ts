/**
 * Payload when stack monitoring is starting or stopping for a given stack deployment.
 */
export interface CloudWatchLogMonitorControlEvent {
    /**
     * A unique identifier for a monitor
     *
     * Use this value to attribute events received for concurrent log monitoring.
     */
    readonly monitor: string;
    /**
     * The names of monitored log groups
     */
    readonly logGroupNames: string[];
}
/**
 * Represents a CloudWatch Log Event that will be
 * printed to the terminal
 */
export interface CloudWatchLogEvent {
    /**
     * The log event message
     */
    readonly message: string;
    /**
     * The name of the log group
     */
    readonly logGroupName: string;
    /**
     * The time at which the event occurred
     */
    readonly timestamp: Date;
}
