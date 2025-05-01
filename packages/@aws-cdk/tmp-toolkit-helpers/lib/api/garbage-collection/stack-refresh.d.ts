import type { ICloudFormationClient } from '../aws-auth';
import { type IoHelper } from '../io/private';
export declare class ActiveAssetCache {
    private readonly stacks;
    rememberStack(stackTemplate: string): void;
    contains(asset: string): boolean;
}
export declare function refreshStacks(cfn: ICloudFormationClient, ioHelper: IoHelper, activeAssets: ActiveAssetCache, qualifier?: string): Promise<void>;
/**
 * Background Stack Refresh properties
 */
export interface BackgroundStackRefreshProps {
    /**
     * The CFN SDK handler
     */
    readonly cfn: ICloudFormationClient;
    /**
     * Used to send messages.
     */
    readonly ioHelper: IoHelper;
    /**
     * Active Asset storage
     */
    readonly activeAssets: ActiveAssetCache;
    /**
     * Stack bootstrap qualifier
     */
    readonly qualifier?: string;
}
/**
 * Class that controls scheduling of the background stack refresh
 */
export declare class BackgroundStackRefresh {
    private readonly props;
    private timeout?;
    private lastRefreshTime;
    private queuedPromises;
    constructor(props: BackgroundStackRefreshProps);
    start(): void;
    private refresh;
    private justRefreshedStacks;
    /**
     * Checks if the last successful background refresh happened within the specified time frame.
     * If the last refresh is older than the specified time frame, it returns a Promise that resolves
     * when the next background refresh completes or rejects if the refresh takes too long.
     */
    noOlderThan(ms: number): Promise<unknown>;
    stop(): void;
}
