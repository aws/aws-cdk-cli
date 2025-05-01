import { type Environment } from '@aws-cdk/cx-api';
import type { ClientOptions, EventType, Account, AssetManifest, IAws, IECRClient, IPublishProgress, IPublishProgressListener, IS3Client, ISecretsManagerClient } from 'cdk-assets';
import type { SdkProvider } from '../aws-auth';
import type { IoHelper } from '../io/private';
interface PublishAssetsOptions {
    /**
     * Whether to build/publish assets in parallel
     *
     * @default true To remain backward compatible.
     */
    readonly parallel?: boolean;
    /**
     * Whether cdk-assets is allowed to do cross account publishing.
     */
    readonly allowCrossAccount: boolean;
}
/**
 * Use cdk-assets to publish all assets in the given manifest.
 *
 * @deprecated used in legacy deployments only, should be migrated at some point
 */
export declare function publishAssets(manifest: AssetManifest, sdk: SdkProvider, targetEnv: Environment, options: PublishAssetsOptions, ioHelper: IoHelper): Promise<void>;
export declare class PublishingAws implements IAws {
    /**
     * The base SDK to work with
     */
    private readonly aws;
    /**
     * Environment where the stack we're deploying is going
     */
    private readonly targetEnv;
    private sdkCache;
    constructor(
    /**
     * The base SDK to work with
     */
    aws: SdkProvider, 
    /**
     * Environment where the stack we're deploying is going
     */
    targetEnv: Environment);
    discoverPartition(): Promise<string>;
    discoverDefaultRegion(): Promise<string>;
    discoverCurrentAccount(): Promise<Account>;
    discoverTargetAccount(options: ClientOptions): Promise<Account>;
    s3Client(options: ClientOptions): Promise<IS3Client>;
    ecrClient(options: ClientOptions): Promise<IECRClient>;
    secretsManagerClient(options: ClientOptions): Promise<ISecretsManagerClient>;
    /**
     * Get an SDK appropriate for the given client options
     */
    private sdk;
}
export declare abstract class BasePublishProgressListener implements IPublishProgressListener {
    protected readonly ioHelper: IoHelper;
    constructor(ioHelper: IoHelper);
    protected abstract getMessage(type: EventType, event: IPublishProgress): string;
    onPublishEvent(type: EventType, event: IPublishProgress): void;
}
export {};
