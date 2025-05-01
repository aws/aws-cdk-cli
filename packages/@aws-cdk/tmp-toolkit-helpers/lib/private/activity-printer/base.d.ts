import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { IoMessage } from '../../api/io';
import { type StackActivity, type StackProgress } from '../../payloads';
export interface IActivityPrinter {
    notify(msg: IoMessage<unknown>): void;
}
export interface ActivityPrinterProps {
    /**
     * Stream to write to
     */
    readonly stream: NodeJS.WriteStream;
}
export declare abstract class ActivityPrinterBase implements IActivityPrinter {
    protected readonly props: ActivityPrinterProps;
    protected static readonly TIMESTAMP_WIDTH = 12;
    protected static readonly STATUS_WIDTH = 20;
    /**
     * Stream to write to
     */
    protected readonly stream: NodeJS.WriteStream;
    /**
     * The with of the "resource type" column.
     */
    protected resourceTypeColumnWidth: number;
    /**
     * A list of resource IDs which are currently being processed
     */
    protected resourcesInProgress: Record<string, StackActivity>;
    protected stackProgress?: StackProgress;
    protected rollingBack: boolean;
    protected readonly failures: StackActivity[];
    protected hookFailureMap: Map<string, Map<string, string>>;
    constructor(props: ActivityPrinterProps);
    protected abstract print(): void;
    /**
     * Receive a stack activity message
     */
    notify(msg: IoMessage<unknown>): void;
    start({ stack }: {
        stack: CloudFormationStackArtifact;
    }): void;
    activity(activity: StackActivity): void;
    stop(): void;
    protected addActivity(activity: StackActivity): void;
    protected failureReason(activity: StackActivity): string;
    /**
     * Is the activity a meta activity for the stack itself.
     */
    protected isActivityForTheStack(activity: StackActivity): boolean;
}
