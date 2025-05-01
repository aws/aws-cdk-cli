import type { ActivityPrinterProps } from './base';
import { ActivityPrinterBase } from './base';
import type { StackActivity } from '../../payloads';
/**
 * Activity Printer which shows a full log of all CloudFormation events
 *
 * When there hasn't been activity for a while, it will print the resources
 * that are currently in progress, to show what's holding up the deployment.
 */
export declare class HistoryActivityPrinter extends ActivityPrinterBase {
    /**
     * Last time we printed something to the console.
     *
     * Used to measure timeout for progress reporting.
     */
    private lastPrintTime;
    private lastPrinted?;
    /**
     * Number of ms of change absence before we tell the user about the resources that are currently in progress.
     */
    private readonly inProgressDelay;
    private readonly printable;
    constructor(props: ActivityPrinterProps);
    activity(activity: StackActivity): void;
    stop(): void;
    protected print(): void;
    private printOne;
    /**
     * If some resources are taking a while to create, notify the user about what's currently in progress
     */
    private printInProgress;
}
