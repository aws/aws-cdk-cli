import type * as cxapi from '@aws-cdk/cx-api';
import type { Tag } from '@aws-sdk/client-s3';
import type { IS3Client, SDK, SdkProvider } from '../aws-auth';
import { ActiveAssetCache, BackgroundStackRefresh } from './stack-refresh';
import { type IoHelper } from '../io/private';
export declare const S3_ISOLATED_TAG = "aws-cdk:isolated";
export declare const ECR_ISOLATED_TAG = "aws-cdk.isolated";
export type GcAsset = ImageAsset | ObjectAsset;
/**
 * An image asset that lives in the bootstrapped ECR Repository
 */
export declare class ImageAsset {
    readonly digest: string;
    readonly size: number;
    readonly tags: string[];
    readonly manifest: string;
    constructor(digest: string, size: number, tags: string[], manifest: string);
    private getTag;
    private hasTag;
    hasIsolatedTag(): boolean;
    getIsolatedTag(): string | undefined;
    isolatedTagBefore(date: Date): boolean;
    buildImageTag(inc: number): string;
    dateIsolated(): string | undefined;
}
/**
 * An object asset that lives in the bootstrapped S3 Bucket
 */
export declare class ObjectAsset {
    private readonly bucket;
    readonly key: string;
    readonly size: number;
    private cached_tags;
    constructor(bucket: string, key: string, size: number);
    fileName(): string;
    allTags(s3: IS3Client): Promise<Tag[] | undefined>;
    private getTag;
    private hasTag;
    hasIsolatedTag(): boolean;
    isolatedTagBefore(date: Date): boolean;
}
/**
 * Props for the Garbage Collector
 */
interface GarbageCollectorProps {
    /**
     * The action to perform. Specify this if you want to perform a truncated set
     * of actions available.
     */
    readonly action: 'print' | 'tag' | 'delete-tagged' | 'full';
    /**
     * The type of asset to garbage collect.
     */
    readonly type: 's3' | 'ecr' | 'all';
    /**
     * The days an asset must be in isolation before being actually deleted.
     */
    readonly rollbackBufferDays: number;
    /**
     * Refuse deletion of any assets younger than this number of days.
     */
    readonly createdBufferDays: number;
    /**
     * The environment to deploy this stack in
     *
     * The environment on the stack artifact may be unresolved, this one
     * must be resolved.
     */
    readonly resolvedEnvironment: cxapi.Environment;
    /**
     * SDK provider (seeded with default credentials)
     *
     * Will be used to make SDK calls to CloudFormation, S3, and ECR.
     */
    readonly sdkProvider: SdkProvider;
    /**
     * Used to send messages.
     */
    readonly ioHelper: IoHelper;
    /**
     * The name of the bootstrap stack to look for.
     *
     * @default DEFAULT_TOOLKIT_STACK_NAME
     */
    readonly bootstrapStackName?: string;
    /**
     * Confirm with the user before actual deletion happens
     *
     * @default true
     */
    readonly confirm?: boolean;
}
/**
 * A class to facilitate Garbage Collection of S3 and ECR assets
 */
export declare class GarbageCollector {
    readonly props: GarbageCollectorProps;
    private garbageCollectS3Assets;
    private garbageCollectEcrAssets;
    private permissionToDelete;
    private permissionToTag;
    private bootstrapStackName;
    private confirm;
    private ioHelper;
    constructor(props: GarbageCollectorProps);
    /**
     * Perform garbage collection on the resolved environment.
     */
    garbageCollect(): Promise<void>;
    /**
     * Perform garbage collection on ECR assets
     */
    garbageCollectEcr(sdk: SDK, activeAssets: ActiveAssetCache, backgroundStackRefresh: BackgroundStackRefresh): Promise<void>;
    /**
     * Perform garbage collection on S3 assets
     */
    garbageCollectS3(sdk: SDK, activeAssets: ActiveAssetCache, backgroundStackRefresh: BackgroundStackRefresh): Promise<void>;
    private parallelReadAllTags;
    /**
     * Untag assets that were previously tagged, but now currently referenced.
     * Since this is treated as an implementation detail, we do not print the results in the printer.
     */
    private parallelUntagEcr;
    /**
     * Untag assets that were previously tagged, but now currently referenced.
     * Since this is treated as an implementation detail, we do not print the results in the printer.
     */
    private parallelUntagS3;
    /**
     * Tag images in parallel using p-limit
     */
    private parallelTagEcr;
    /**
     * Tag objects in parallel using p-limit. The putObjectTagging API does not
     * support batch tagging so we must handle the parallelism client-side.
     */
    private parallelTagS3;
    /**
     * Delete images in parallel. The deleteImage API supports batches of 100.
     */
    private parallelDeleteEcr;
    /**
     * Delete objects in parallel. The deleteObjects API supports batches of 1000.
     */
    private parallelDeleteS3;
    private bootstrapBucketName;
    private bootstrapRepositoryName;
    private bootstrapQualifier;
    private numObjectsInBucket;
    private numImagesInRepo;
    private readRepoInBatches;
    /**
     * Generator function that reads objects from the S3 Bucket in batches.
     */
    private readBucketInBatches;
    private confirmationPrompt;
}
export {};
