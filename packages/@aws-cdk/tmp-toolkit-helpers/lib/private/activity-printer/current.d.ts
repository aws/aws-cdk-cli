import type { ActivityPrinterProps } from './base';
import { ActivityPrinterBase } from './base';
/**
 * Activity Printer which shows the resources currently being updated
 *
 * It will continuously re-update the terminal and show only the resources
 * that are currently being updated, in addition to a progress bar which
 * shows how far along the deployment is.
 *
 * Resources that have failed will always be shown, and will be recapitulated
 * along with their stack trace when the monitoring ends.
 *
 * Resources that failed deployment because they have been cancelled are
 * not included.
 */
export declare class CurrentActivityPrinter extends ActivityPrinterBase {
    /**
     * Continuously write to the same output block.
     */
    private block;
    constructor(props: ActivityPrinterProps);
    protected print(): void;
    stop(): void;
    private progressBar;
    private failureReasonOnNextLine;
}
