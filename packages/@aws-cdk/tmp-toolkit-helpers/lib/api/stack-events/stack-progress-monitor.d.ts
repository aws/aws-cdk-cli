import type { StackProgress } from '@aws-cdk/tmp-toolkit-helpers';
import type { StackEvent } from '@aws-sdk/client-cloudformation';
/**
 * Monitors stack progress.s
 */
export declare class StackProgressMonitor {
    /**
     * Previous completion state observed by logical ID
     *
     * We use this to detect that if we see a DELETE_COMPLETE after a
     * CREATE_COMPLETE, it's actually a rollback and we should DECREASE
     * resourcesDone instead of increase it
     */
    private resourcesPrevCompleteState;
    /**
     * Count of resources that have reported a _COMPLETE status
     */
    private resourcesDone;
    /**
     * How many digits we need to represent the total count (for lining up the status reporting)
     */
    private readonly resourceDigits;
    /**
     * Number of expected resources in the monitor.
     */
    private readonly resourcesTotal?;
    constructor(resourcesTotal?: number);
    /**
     * Report the stack progress
     */
    get progress(): StackProgress;
    /**
     * The total number of progress monitored resources.
     */
    get total(): number | undefined;
    /**
     * The number of completed resources.
     */
    get completed(): number;
    /**
     * Report the current progress as a [34/42] string, or just [34] if the total is unknown
     */
    get formatted(): string;
    /**
     * Process as stack event and update the progress state.
     */
    process(event: StackEvent): void;
}
