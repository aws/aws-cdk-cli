"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GarbageCollector = exports.ObjectAsset = exports.ImageAsset = exports.ECR_ISOLATED_TAG = exports.S3_ISOLATED_TAG = void 0;
const chalk = require("chalk");
const promptly = require("promptly");
const toolkit_info_1 = require("../toolkit-info");
const progress_printer_1 = require("./progress-printer");
const stack_refresh_1 = require("./stack-refresh");
const private_1 = require("../io/private");
const plugin_1 = require("../plugin");
const toolkit_error_1 = require("../toolkit-error");
// Must use a require() otherwise esbuild complains
// eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/consistent-type-imports
const pLimit = require('p-limit');
exports.S3_ISOLATED_TAG = 'aws-cdk:isolated';
exports.ECR_ISOLATED_TAG = 'aws-cdk.isolated'; // ':' is not valid in ECR tags
const P_LIMIT = 50;
const DAY = 24 * 60 * 60 * 1000; // Number of milliseconds in a day
/**
 * An image asset that lives in the bootstrapped ECR Repository
 */
class ImageAsset {
    digest;
    size;
    tags;
    manifest;
    constructor(digest, size, tags, manifest) {
        this.digest = digest;
        this.size = size;
        this.tags = tags;
        this.manifest = manifest;
    }
    getTag(tag) {
        return this.tags.find(t => t.includes(tag));
    }
    hasTag(tag) {
        return this.tags.some(t => t.includes(tag));
    }
    hasIsolatedTag() {
        return this.hasTag(exports.ECR_ISOLATED_TAG);
    }
    getIsolatedTag() {
        return this.getTag(exports.ECR_ISOLATED_TAG);
    }
    isolatedTagBefore(date) {
        const dateIsolated = this.dateIsolated();
        if (!dateIsolated || dateIsolated == '') {
            return false;
        }
        return new Date(dateIsolated) < date;
    }
    buildImageTag(inc) {
        // isolatedTag will look like "X-aws-cdk.isolated-YYYYY"
        return `${inc}-${exports.ECR_ISOLATED_TAG}-${String(Date.now())}`;
    }
    dateIsolated() {
        // isolatedTag will look like "X-aws-cdk.isolated-YYYYY"
        return this.getIsolatedTag()?.split('-')[3];
    }
}
exports.ImageAsset = ImageAsset;
/**
 * An object asset that lives in the bootstrapped S3 Bucket
 */
class ObjectAsset {
    bucket;
    key;
    size;
    cached_tags = undefined;
    constructor(bucket, key, size) {
        this.bucket = bucket;
        this.key = key;
        this.size = size;
    }
    fileName() {
        return this.key.split('.')[0];
    }
    async allTags(s3) {
        if (this.cached_tags) {
            return this.cached_tags;
        }
        const response = await s3.getObjectTagging({ Bucket: this.bucket, Key: this.key });
        this.cached_tags = response.TagSet;
        return this.cached_tags;
    }
    getTag(tag) {
        if (!this.cached_tags) {
            throw new toolkit_error_1.ToolkitError('Cannot call getTag before allTags');
        }
        return this.cached_tags.find((t) => t.Key === tag)?.Value;
    }
    hasTag(tag) {
        if (!this.cached_tags) {
            throw new toolkit_error_1.ToolkitError('Cannot call hasTag before allTags');
        }
        return this.cached_tags.some((t) => t.Key === tag);
    }
    hasIsolatedTag() {
        return this.hasTag(exports.S3_ISOLATED_TAG);
    }
    isolatedTagBefore(date) {
        const tagValue = this.getTag(exports.S3_ISOLATED_TAG);
        if (!tagValue || tagValue == '') {
            return false;
        }
        return new Date(tagValue) < date;
    }
}
exports.ObjectAsset = ObjectAsset;
/**
 * A class to facilitate Garbage Collection of S3 and ECR assets
 */
class GarbageCollector {
    props;
    garbageCollectS3Assets;
    garbageCollectEcrAssets;
    permissionToDelete;
    permissionToTag;
    bootstrapStackName;
    confirm;
    ioHelper;
    constructor(props) {
        this.props = props;
        this.ioHelper = props.ioHelper;
        this.garbageCollectS3Assets = ['s3', 'all'].includes(props.type);
        this.garbageCollectEcrAssets = ['ecr', 'all'].includes(props.type);
        this.permissionToDelete = ['delete-tagged', 'full'].includes(props.action);
        this.permissionToTag = ['tag', 'full'].includes(props.action);
        this.confirm = props.confirm ?? true;
        this.bootstrapStackName = props.bootstrapStackName ?? toolkit_info_1.DEFAULT_TOOLKIT_STACK_NAME;
    }
    /**
     * Perform garbage collection on the resolved environment.
     */
    async garbageCollect() {
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${this.garbageCollectS3Assets} ${this.garbageCollectEcrAssets}`));
        // SDKs
        const sdk = (await this.props.sdkProvider.forEnvironment(this.props.resolvedEnvironment, plugin_1.Mode.ForWriting)).sdk;
        const cfn = sdk.cloudFormation();
        const qualifier = await this.bootstrapQualifier(sdk, this.bootstrapStackName);
        const activeAssets = new stack_refresh_1.ActiveAssetCache();
        // Grab stack templates first
        await (0, stack_refresh_1.refreshStacks)(cfn, this.ioHelper, activeAssets, qualifier);
        // Start the background refresh
        const backgroundStackRefresh = new stack_refresh_1.BackgroundStackRefresh({
            cfn,
            ioHelper: this.ioHelper,
            activeAssets,
            qualifier,
        });
        backgroundStackRefresh.start();
        try {
            if (this.garbageCollectS3Assets) {
                await this.garbageCollectS3(sdk, activeAssets, backgroundStackRefresh);
            }
            if (this.garbageCollectEcrAssets) {
                await this.garbageCollectEcr(sdk, activeAssets, backgroundStackRefresh);
            }
        }
        catch (err) {
            throw new toolkit_error_1.ToolkitError(err);
        }
        finally {
            backgroundStackRefresh.stop();
        }
    }
    /**
     * Perform garbage collection on ECR assets
     */
    async garbageCollectEcr(sdk, activeAssets, backgroundStackRefresh) {
        const ecr = sdk.ecr();
        const repo = await this.bootstrapRepositoryName(sdk, this.bootstrapStackName);
        const numImages = await this.numImagesInRepo(ecr, repo);
        const printer = new progress_printer_1.ProgressPrinter(this.ioHelper, numImages, 1000);
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Found bootstrap repo ${repo} with ${numImages} images`));
        try {
            // const batches = 1;
            const batchSize = 1000;
            const currentTime = Date.now();
            const graceDays = this.props.rollbackBufferDays;
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Parsing through ${numImages} images in batches`));
            printer.start();
            for await (const batch of this.readRepoInBatches(ecr, repo, batchSize, currentTime)) {
                await backgroundStackRefresh.noOlderThan(600_000); // 10 mins
                const { included: isolated, excluded: notIsolated } = partition(batch, asset => !asset.tags.some(t => activeAssets.contains(t)));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${isolated.length} isolated images`));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${notIsolated.length} not isolated images`));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${batch.length} images total`));
                let deletables = isolated;
                let taggables = [];
                let untaggables = [];
                if (graceDays > 0) {
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg('Filtering out images that are not old enough to delete'));
                    // We delete images that are not referenced in ActiveAssets and have the Isolated Tag with a date
                    // earlier than the current time - grace period.
                    deletables = isolated.filter(img => img.isolatedTagBefore(new Date(currentTime - (graceDays * DAY))));
                    // We tag images that are not referenced in ActiveAssets and do not have the Isolated Tag.
                    taggables = isolated.filter(img => !img.hasIsolatedTag());
                    // We untag images that are referenced in ActiveAssets and currently have the Isolated Tag.
                    untaggables = notIsolated.filter(img => img.hasIsolatedTag());
                }
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deletables.length} deletable assets`));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${taggables.length} taggable assets`));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${untaggables.length} assets to untag`));
                if (this.permissionToDelete && deletables.length > 0) {
                    await this.confirmationPrompt(printer, deletables, 'image');
                    await this.parallelDeleteEcr(ecr, repo, deletables, printer);
                }
                if (this.permissionToTag && taggables.length > 0) {
                    await this.parallelTagEcr(ecr, repo, taggables, printer);
                }
                if (this.permissionToTag && untaggables.length > 0) {
                    await this.parallelUntagEcr(ecr, repo, untaggables);
                }
                printer.reportScannedAsset(batch.length);
            }
        }
        catch (err) {
            throw new toolkit_error_1.ToolkitError(err);
        }
        finally {
            printer.stop();
        }
    }
    /**
     * Perform garbage collection on S3 assets
     */
    async garbageCollectS3(sdk, activeAssets, backgroundStackRefresh) {
        const s3 = sdk.s3();
        const bucket = await this.bootstrapBucketName(sdk, this.bootstrapStackName);
        const numObjects = await this.numObjectsInBucket(s3, bucket);
        const printer = new progress_printer_1.ProgressPrinter(this.ioHelper, numObjects, 1000);
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Found bootstrap bucket ${bucket} with ${numObjects} objects`));
        try {
            const batchSize = 1000;
            const currentTime = Date.now();
            const graceDays = this.props.rollbackBufferDays;
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Parsing through ${numObjects} objects in batches`));
            printer.start();
            // Process objects in batches of 1000
            // This is the batch limit of s3.DeleteObject and we intend to optimize for the "worst case" scenario
            // where gc is run for the first time on a long-standing bucket where ~100% of objects are isolated.
            for await (const batch of this.readBucketInBatches(s3, bucket, batchSize, currentTime)) {
                await backgroundStackRefresh.noOlderThan(600_000); // 10 mins
                const { included: isolated, excluded: notIsolated } = partition(batch, asset => !activeAssets.contains(asset.fileName()));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${isolated.length} isolated assets`));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${notIsolated.length} not isolated assets`));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${batch.length} objects total`));
                let deletables = isolated;
                let taggables = [];
                let untaggables = [];
                if (graceDays > 0) {
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg('Filtering out assets that are not old enough to delete'));
                    await this.parallelReadAllTags(s3, batch);
                    // We delete objects that are not referenced in ActiveAssets and have the Isolated Tag with a date
                    // earlier than the current time - grace period.
                    deletables = isolated.filter(obj => obj.isolatedTagBefore(new Date(currentTime - (graceDays * DAY))));
                    // We tag objects that are not referenced in ActiveAssets and do not have the Isolated Tag.
                    taggables = isolated.filter(obj => !obj.hasIsolatedTag());
                    // We untag objects that are referenced in ActiveAssets and currently have the Isolated Tag.
                    untaggables = notIsolated.filter(obj => obj.hasIsolatedTag());
                }
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deletables.length} deletable assets`));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${taggables.length} taggable assets`));
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${untaggables.length} assets to untag`));
                if (this.permissionToDelete && deletables.length > 0) {
                    await this.confirmationPrompt(printer, deletables, 'object');
                    await this.parallelDeleteS3(s3, bucket, deletables, printer);
                }
                if (this.permissionToTag && taggables.length > 0) {
                    await this.parallelTagS3(s3, bucket, taggables, currentTime, printer);
                }
                if (this.permissionToTag && untaggables.length > 0) {
                    await this.parallelUntagS3(s3, bucket, untaggables);
                }
                printer.reportScannedAsset(batch.length);
            }
        }
        catch (err) {
            throw new toolkit_error_1.ToolkitError(err);
        }
        finally {
            printer.stop();
        }
    }
    async parallelReadAllTags(s3, objects) {
        const limit = pLimit(P_LIMIT);
        for (const obj of objects) {
            await limit(() => obj.allTags(s3));
        }
    }
    /**
     * Untag assets that were previously tagged, but now currently referenced.
     * Since this is treated as an implementation detail, we do not print the results in the printer.
     */
    async parallelUntagEcr(ecr, repo, untaggables) {
        const limit = pLimit(P_LIMIT);
        for (const img of untaggables) {
            const tag = img.getIsolatedTag();
            await limit(() => ecr.batchDeleteImage({
                repositoryName: repo,
                imageIds: [{
                        imageTag: tag,
                    }],
            }));
        }
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Untagged ${untaggables.length} assets`));
    }
    /**
     * Untag assets that were previously tagged, but now currently referenced.
     * Since this is treated as an implementation detail, we do not print the results in the printer.
     */
    async parallelUntagS3(s3, bucket, untaggables) {
        const limit = pLimit(P_LIMIT);
        for (const obj of untaggables) {
            const tags = await obj.allTags(s3) ?? [];
            const updatedTags = tags.filter((tag) => tag.Key !== exports.S3_ISOLATED_TAG);
            await limit(() => s3.deleteObjectTagging({
                Bucket: bucket,
                Key: obj.key,
            }));
            await limit(() => s3.putObjectTagging({
                Bucket: bucket,
                Key: obj.key,
                Tagging: {
                    TagSet: updatedTags,
                },
            }));
        }
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Untagged ${untaggables.length} assets`));
    }
    /**
     * Tag images in parallel using p-limit
     */
    async parallelTagEcr(ecr, repo, taggables, printer) {
        const limit = pLimit(P_LIMIT);
        for (let i = 0; i < taggables.length; i++) {
            const img = taggables[i];
            const tagEcr = async () => {
                try {
                    await ecr.putImage({
                        repositoryName: repo,
                        imageDigest: img.digest,
                        imageManifest: img.manifest,
                        imageTag: img.buildImageTag(i),
                    });
                }
                catch (error) {
                    // This is a false negative -- an isolated asset is untagged
                    // likely due to an imageTag collision. We can safely ignore,
                    // and the isolated asset will be tagged next time.
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Warning: unable to tag image ${JSON.stringify(img.tags)} with ${img.buildImageTag(i)} due to the following error: ${error}`));
                }
            };
            await limit(() => tagEcr());
        }
        printer.reportTaggedAsset(taggables);
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Tagged ${taggables.length} assets`));
    }
    /**
     * Tag objects in parallel using p-limit. The putObjectTagging API does not
     * support batch tagging so we must handle the parallelism client-side.
     */
    async parallelTagS3(s3, bucket, taggables, date, printer) {
        const limit = pLimit(P_LIMIT);
        for (const obj of taggables) {
            await limit(() => s3.putObjectTagging({
                Bucket: bucket,
                Key: obj.key,
                Tagging: {
                    TagSet: [
                        {
                            Key: exports.S3_ISOLATED_TAG,
                            Value: String(date),
                        },
                    ],
                },
            }));
        }
        printer.reportTaggedAsset(taggables);
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Tagged ${taggables.length} assets`));
    }
    /**
     * Delete images in parallel. The deleteImage API supports batches of 100.
     */
    async parallelDeleteEcr(ecr, repo, deletables, printer) {
        const batchSize = 100;
        const imagesToDelete = deletables.map(img => ({
            imageDigest: img.digest,
        }));
        try {
            const batches = [];
            for (let i = 0; i < imagesToDelete.length; i += batchSize) {
                batches.push(imagesToDelete.slice(i, i + batchSize));
            }
            // Delete images in batches
            for (const batch of batches) {
                await ecr.batchDeleteImage({
                    imageIds: batch,
                    repositoryName: repo,
                });
                const deletedCount = batch.length;
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Deleted ${deletedCount} assets`));
                printer.reportDeletedAsset(deletables.slice(0, deletedCount));
            }
        }
        catch (err) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_ERROR.msg(`Error deleting images: ${err}`));
        }
    }
    /**
     * Delete objects in parallel. The deleteObjects API supports batches of 1000.
     */
    async parallelDeleteS3(s3, bucket, deletables, printer) {
        const batchSize = 1000;
        const objectsToDelete = deletables.map(asset => ({
            Key: asset.key,
        }));
        try {
            const batches = [];
            for (let i = 0; i < objectsToDelete.length; i += batchSize) {
                batches.push(objectsToDelete.slice(i, i + batchSize));
            }
            // Delete objects in batches
            for (const batch of batches) {
                await s3.deleteObjects({
                    Bucket: bucket,
                    Delete: {
                        Objects: batch,
                        Quiet: true,
                    },
                });
                const deletedCount = batch.length;
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Deleted ${deletedCount} assets`));
                printer.reportDeletedAsset(deletables.slice(0, deletedCount));
            }
        }
        catch (err) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(chalk.red(`Error deleting objects: ${err}`)));
        }
    }
    async bootstrapBucketName(sdk, bootstrapStackName) {
        const toolkitInfo = await toolkit_info_1.ToolkitInfo.lookup(this.props.resolvedEnvironment, sdk, this.ioHelper, bootstrapStackName);
        return toolkitInfo.bucketName;
    }
    async bootstrapRepositoryName(sdk, bootstrapStackName) {
        const toolkitInfo = await toolkit_info_1.ToolkitInfo.lookup(this.props.resolvedEnvironment, sdk, this.ioHelper, bootstrapStackName);
        return toolkitInfo.repositoryName;
    }
    async bootstrapQualifier(sdk, bootstrapStackName) {
        const toolkitInfo = await toolkit_info_1.ToolkitInfo.lookup(this.props.resolvedEnvironment, sdk, this.ioHelper, bootstrapStackName);
        return toolkitInfo.bootstrapStack.parameters.Qualifier;
    }
    async numObjectsInBucket(s3, bucket) {
        let totalCount = 0;
        let continuationToken;
        do {
            const response = await s3.listObjectsV2({
                Bucket: bucket,
                ContinuationToken: continuationToken,
            });
            totalCount += response.KeyCount ?? 0;
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);
        return totalCount;
    }
    async numImagesInRepo(ecr, repo) {
        let totalCount = 0;
        let nextToken;
        do {
            const response = await ecr.listImages({
                repositoryName: repo,
                nextToken: nextToken,
            });
            totalCount += response.imageIds?.length ?? 0;
            nextToken = response.nextToken;
        } while (nextToken);
        return totalCount;
    }
    async *readRepoInBatches(ecr, repo, batchSize = 1000, currentTime) {
        let continuationToken;
        do {
            const batch = [];
            while (batch.length < batchSize) {
                const response = await ecr.listImages({
                    repositoryName: repo,
                    nextToken: continuationToken,
                });
                // No images in the repository
                if (!response.imageIds || response.imageIds.length === 0) {
                    break;
                }
                // map unique image digest to (possibly multiple) tags
                const images = imageMap(response.imageIds ?? []);
                const imageIds = Object.keys(images).map(key => ({
                    imageDigest: key,
                }));
                const describeImageInfo = await ecr.describeImages({
                    repositoryName: repo,
                    imageIds: imageIds,
                });
                const getImageInfo = await ecr.batchGetImage({
                    repositoryName: repo,
                    imageIds: imageIds,
                });
                const combinedImageInfo = describeImageInfo.imageDetails?.map(imageDetail => {
                    const matchingImage = getImageInfo.images?.find(img => img.imageId?.imageDigest === imageDetail.imageDigest);
                    return {
                        ...imageDetail,
                        manifest: matchingImage?.imageManifest,
                    };
                });
                for (const image of combinedImageInfo ?? []) {
                    const lastModified = image.imagePushedAt ?? new Date(currentTime);
                    // Store the image if it was pushed earlier than today - createdBufferDays
                    if (image.imageDigest && lastModified < new Date(currentTime - (this.props.createdBufferDays * DAY))) {
                        batch.push(new ImageAsset(image.imageDigest, image.imageSizeInBytes ?? 0, image.imageTags ?? [], image.manifest ?? ''));
                    }
                }
                continuationToken = response.nextToken;
                if (!continuationToken)
                    break; // No more images to fetch
            }
            if (batch.length > 0) {
                yield batch;
            }
        } while (continuationToken);
    }
    /**
     * Generator function that reads objects from the S3 Bucket in batches.
     */
    async *readBucketInBatches(s3, bucket, batchSize = 1000, currentTime) {
        let continuationToken;
        do {
            const batch = [];
            while (batch.length < batchSize) {
                const response = await s3.listObjectsV2({
                    Bucket: bucket,
                    ContinuationToken: continuationToken,
                });
                response.Contents?.forEach((obj) => {
                    const key = obj.Key ?? '';
                    const size = obj.Size ?? 0;
                    const lastModified = obj.LastModified ?? new Date(currentTime);
                    // Store the object if it has a Key and
                    // if it has not been modified since today - createdBufferDays
                    if (key && lastModified < new Date(currentTime - (this.props.createdBufferDays * DAY))) {
                        batch.push(new ObjectAsset(bucket, key, size));
                    }
                });
                continuationToken = response.NextContinuationToken;
                if (!continuationToken)
                    break; // No more objects to fetch
            }
            if (batch.length > 0) {
                yield batch;
            }
        } while (continuationToken);
    }
    async confirmationPrompt(printer, deletables, type) {
        const pluralize = (name, count) => {
            return count === 1 ? name : `${name}s`;
        };
        if (this.confirm) {
            const message = [
                `Found ${deletables.length} ${pluralize(type, deletables.length)} to delete based off of the following criteria:`,
                `- ${type}s have been isolated for > ${this.props.rollbackBufferDays} days`,
                `- ${type}s were created > ${this.props.createdBufferDays} days ago`,
                '',
                'Delete this batch (yes/no/delete-all)?',
            ].join('\n');
            printer.pause();
            const response = await promptly.prompt(message, { trim: true });
            // Anything other than yes/y/delete-all is treated as no
            if (!response || !['yes', 'y', 'delete-all'].includes(response.toLowerCase())) {
                throw new toolkit_error_1.ToolkitError('Deletion aborted by user');
            }
            else if (response.toLowerCase() == 'delete-all') {
                this.confirm = false;
            }
        }
        printer.resume();
    }
}
exports.GarbageCollector = GarbageCollector;
function partition(xs, pred) {
    const result = {
        included: [],
        excluded: [],
    };
    for (const x of xs) {
        if (pred(x)) {
            result.included.push(x);
        }
        else {
            result.excluded.push(x);
        }
    }
    return result;
}
function imageMap(imageIds) {
    const images = {};
    for (const image of imageIds ?? []) {
        if (!image.imageDigest || !image.imageTag) {
            continue;
        }
        if (!images[image.imageDigest]) {
            images[image.imageDigest] = [];
        }
        images[image.imageDigest].push(image.imageTag);
    }
    return images;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2FyYmFnZS1jb2xsZWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2dhcmJhZ2UtY29sbGVjdGlvbi9nYXJiYWdlLWNvbGxlY3Rvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFHQSwrQkFBK0I7QUFDL0IscUNBQXFDO0FBRXJDLGtEQUEwRTtBQUMxRSx5REFBcUQ7QUFDckQsbURBQTBGO0FBQzFGLDJDQUFrRDtBQUNsRCxzQ0FBaUM7QUFDakMsb0RBQWdEO0FBRWhELG1EQUFtRDtBQUNuRCw0R0FBNEc7QUFDNUcsTUFBTSxNQUFNLEdBQTZCLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUUvQyxRQUFBLGVBQWUsR0FBRyxrQkFBa0IsQ0FBQztBQUNyQyxRQUFBLGdCQUFnQixHQUFHLGtCQUFrQixDQUFDLENBQUMsK0JBQStCO0FBQ25GLE1BQU0sT0FBTyxHQUFHLEVBQUUsQ0FBQztBQUNuQixNQUFNLEdBQUcsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQyxrQ0FBa0M7QUFJbkU7O0dBRUc7QUFDSCxNQUFhLFVBQVU7SUFFSDtJQUNBO0lBQ0E7SUFDQTtJQUpsQixZQUNrQixNQUFjLEVBQ2QsSUFBWSxFQUNaLElBQWMsRUFDZCxRQUFnQjtRQUhoQixXQUFNLEdBQU4sTUFBTSxDQUFRO1FBQ2QsU0FBSSxHQUFKLElBQUksQ0FBUTtRQUNaLFNBQUksR0FBSixJQUFJLENBQVU7UUFDZCxhQUFRLEdBQVIsUUFBUSxDQUFRO0lBRWxDLENBQUM7SUFFTyxNQUFNLENBQUMsR0FBVztRQUN4QixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFFTyxNQUFNLENBQUMsR0FBVztRQUN4QixPQUFPLElBQUksQ0FBQyxJQUFJ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d3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgdHlwZSB7IEltYWdlSWRlbnRpZmllciB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1lY3InO1xuaW1wb3J0IHR5cGUgeyBUYWcgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0ICogYXMgY2hhbGsgZnJvbSAnY2hhbGsnO1xuaW1wb3J0ICogYXMgcHJvbXB0bHkgZnJvbSAncHJvbXB0bHknO1xuaW1wb3J0IHR5cGUgeyBJRUNSQ2xpZW50LCBJUzNDbGllbnQsIFNESywgU2RrUHJvdmlkZXIgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgeyBERUZBVUxUX1RPT0xLSVRfU1RBQ0tfTkFNRSwgVG9vbGtpdEluZm8gfSBmcm9tICcuLi90b29sa2l0LWluZm8nO1xuaW1wb3J0IHsgUHJvZ3Jlc3NQcmludGVyIH0gZnJvbSAnLi9wcm9ncmVzcy1wcmludGVyJztcbmltcG9ydCB7IEFjdGl2ZUFzc2V0Q2FjaGUsIEJhY2tncm91bmRTdGFja1JlZnJlc2gsIHJlZnJlc2hTdGFja3MgfSBmcm9tICcuL3N0YWNrLXJlZnJlc2gnO1xuaW1wb3J0IHsgSU8sIHR5cGUgSW9IZWxwZXIgfSBmcm9tICcuLi9pby9wcml2YXRlJztcbmltcG9ydCB7IE1vZGUgfSBmcm9tICcuLi9wbHVnaW4nO1xuaW1wb3J0IHsgVG9vbGtpdEVycm9yIH0gZnJvbSAnLi4vdG9vbGtpdC1lcnJvcic7XG5cbi8vIE11c3QgdXNlIGEgcmVxdWlyZSgpIG90aGVyd2lzZSBlc2J1aWxkIGNvbXBsYWluc1xuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHMsQHR5cGVzY3JpcHQtZXNsaW50L2NvbnNpc3RlbnQtdHlwZS1pbXBvcnRzXG5jb25zdCBwTGltaXQ6IHR5cGVvZiBpbXBvcnQoJ3AtbGltaXQnKSA9IHJlcXVpcmUoJ3AtbGltaXQnKTtcblxuZXhwb3J0IGNvbnN0IFMzX0lTT0xBVEVEX1RBRyA9ICdhd3MtY2RrOmlzb2xhdGVkJztcbmV4cG9ydCBjb25zdCBFQ1JfSVNPTEFURURfVEFHID0gJ2F3cy1jZGsuaXNvbGF0ZWQnOyAvLyAnOicgaXMgbm90IHZhbGlkIGluIEVDUiB0YWdzXG5jb25zdCBQX0xJTUlUID0gNTA7XG5jb25zdCBEQVkgPSAyNCAqIDYwICogNjAgKiAxMDAwOyAvLyBOdW1iZXIgb2YgbWlsbGlzZWNvbmRzIGluIGEgZGF5XG5cbmV4cG9ydCB0eXBlIEdjQXNzZXQgPSBJbWFnZUFzc2V0IHwgT2JqZWN0QXNzZXQ7XG5cbi8qKlxuICogQW4gaW1hZ2UgYXNzZXQgdGhhdCBsaXZlcyBpbiB0aGUgYm9vdHN0cmFwcGVkIEVDUiBSZXBvc2l0b3J5XG4gKi9cbmV4cG9ydCBjbGFzcyBJbWFnZUFzc2V0IHtcbiAgcHVibGljIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyByZWFkb25seSBkaWdlc3Q6IHN0cmluZyxcbiAgICBwdWJsaWMgcmVhZG9ubHkgc2l6ZTogbnVtYmVyLFxuICAgIHB1YmxpYyByZWFkb25seSB0YWdzOiBzdHJpbmdbXSxcbiAgICBwdWJsaWMgcmVhZG9ubHkgbWFuaWZlc3Q6IHN0cmluZyxcbiAgKSB7XG4gIH1cblxuICBwcml2YXRlIGdldFRhZyh0YWc6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLnRhZ3MuZmluZCh0ID0+IHQuaW5jbHVkZXModGFnKSk7XG4gIH1cblxuICBwcml2YXRlIGhhc1RhZyh0YWc6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLnRhZ3Muc29tZSh0ID0+IHQuaW5jbHVkZXModGFnKSk7XG4gIH1cblxuICBwdWJsaWMgaGFzSXNvbGF0ZWRUYWcoKSB7XG4gICAgcmV0dXJuIHRoaXMuaGFzVGFnKEVDUl9JU09MQVRFRF9UQUcpO1xuICB9XG5cbiAgcHVibGljIGdldElzb2xhdGVkVGFnKCkge1xuICAgIHJldHVybiB0aGlzLmdldFRhZyhFQ1JfSVNPTEFURURfVEFHKTtcbiAgfVxuXG4gIHB1YmxpYyBpc29sYXRlZFRhZ0JlZm9yZShkYXRlOiBEYXRlKSB7XG4gICAgY29uc3QgZGF0ZUlzb2xhdGVkID0gdGhpcy5kYXRlSXNvbGF0ZWQoKTtcbiAgICBpZiAoIWRhdGVJc29sYXRlZCB8fCBkYXRlSXNvbGF0ZWQgPT0gJycpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBEYXRlKGRhdGVJc29sYXRlZCkgPCBkYXRlO1xuICB9XG5cbiAgcHVibGljIGJ1aWxkSW1hZ2VUYWcoaW5jOiBudW1iZXIpIHtcbiAgICAvLyBpc29sYXRlZFRhZyB3aWxsIGxvb2sgbGlrZSBcIlgtYXdzLWNkay5pc29sYXRlZC1ZWVlZWVwiXG4gICAgcmV0dXJuIGAke2luY30tJHtFQ1JfSVNPTEFURURfVEFHfS0ke1N0cmluZyhEYXRlLm5vdygpKX1gO1xuICB9XG5cbiAgcHVibGljIGRhdGVJc29sYXRlZCgpIHtcbiAgICAvLyBpc29sYXRlZFRhZyB3aWxsIGxvb2sgbGlrZSBcIlgtYXdzLWNkay5pc29sYXRlZC1ZWVlZWVwiXG4gICAgcmV0dXJuIHRoaXMuZ2V0SXNvbGF0ZWRUYWcoKT8uc3BsaXQoJy0nKVszXTtcbiAgfVxufVxuXG4vKipcbiAqIEFuIG9iamVjdCBhc3NldCB0aGF0IGxpdmVzIGluIHRoZSBib290c3RyYXBwZWQgUzMgQnVja2V0XG4gKi9cbmV4cG9ydCBjbGFzcyBPYmplY3RBc3NldCB7XG4gIHByaXZhdGUgY2FjaGVkX3RhZ3M6IFRhZ1tdIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuXG4gIHB1YmxpYyBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGJ1Y2tldDogc3RyaW5nLCBwdWJsaWMgcmVhZG9ubHkga2V5OiBzdHJpbmcsIHB1YmxpYyByZWFkb25seSBzaXplOiBudW1iZXIpIHtcbiAgfVxuXG4gIHB1YmxpYyBmaWxlTmFtZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmtleS5zcGxpdCgnLicpWzBdO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGFsbFRhZ3MoczM6IElTM0NsaWVudCkge1xuICAgIGlmICh0aGlzLmNhY2hlZF90YWdzKSB7XG4gICAgICByZXR1cm4gdGhpcy5jYWNoZWRfdGFncztcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHMzLmdldE9iamVjdFRhZ2dpbmcoeyBCdWNrZXQ6IHRoaXMuYnVja2V0LCBLZXk6IHRoaXMua2V5IH0pO1xuICAgIHRoaXMuY2FjaGVkX3RhZ3MgPSByZXNwb25zZS5UYWdTZXQ7XG4gICAgcmV0dXJuIHRoaXMuY2FjaGVkX3RhZ3M7XG4gIH1cblxuICBwcml2YXRlIGdldFRhZyh0YWc6IHN0cmluZykge1xuICAgIGlmICghdGhpcy5jYWNoZWRfdGFncykge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcignQ2Fubm90IGNhbGwgZ2V0VGFnIGJlZm9yZSBhbGxUYWdzJyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNhY2hlZF90YWdzLmZpbmQoKHQ6IGFueSkgPT4gdC5LZXkgPT09IHRhZyk/LlZhbHVlO1xuICB9XG5cbiAgcHJpdmF0ZSBoYXNUYWcodGFnOiBzdHJpbmcpIHtcbiAgICBpZiAoIXRoaXMuY2FjaGVkX3RhZ3MpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJ0Nhbm5vdCBjYWxsIGhhc1RhZyBiZWZvcmUgYWxsVGFncycpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5jYWNoZWRfdGFncy5zb21lKCh0OiBhbnkpID0+IHQuS2V5ID09PSB0YWcpO1xuICB9XG5cbiAgcHVibGljIGhhc0lzb2xhdGVkVGFnKCkge1xuICAgIHJldHVybiB0aGlzLmhhc1RhZyhTM19JU09MQVRFRF9UQUcpO1xuICB9XG5cbiAgcHVibGljIGlzb2xhdGVkVGFnQmVmb3JlKGRhdGU6IERhdGUpIHtcbiAgICBjb25zdCB0YWdWYWx1ZSA9IHRoaXMuZ2V0VGFnKFMzX0lTT0xBVEVEX1RBRyk7XG4gICAgaWYgKCF0YWdWYWx1ZSB8fCB0YWdWYWx1ZSA9PSAnJykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IERhdGUodGFnVmFsdWUpIDwgZGF0ZTtcbiAgfVxufVxuXG4vKipcbiAqIFByb3BzIGZvciB0aGUgR2FyYmFnZSBDb2xsZWN0b3JcbiAqL1xuaW50ZXJmYWNlIEdhcmJhZ2VDb2xsZWN0b3JQcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgYWN0aW9uIHRvIHBlcmZvcm0uIFNwZWNpZnkgdGhpcyBpZiB5b3Ugd2FudCB0byBwZXJmb3JtIGEgdHJ1bmNhdGVkIHNldFxuICAgKiBvZiBhY3Rpb25zIGF2YWlsYWJsZS5cbiAgICovXG4gIHJlYWRvbmx5IGFjdGlvbjogJ3ByaW50JyB8ICd0YWcnIHwgJ2RlbGV0ZS10YWdnZWQnIHwgJ2Z1bGwnO1xuXG4gIC8qKlxuICAgKiBUaGUgdHlwZSBvZiBhc3NldCB0byBnYXJiYWdlIGNvbGxlY3QuXG4gICAqL1xuICByZWFkb25seSB0eXBlOiAnczMnIHwgJ2VjcicgfCAnYWxsJztcblxuICAvKipcbiAgICogVGhlIGRheXMgYW4gYXNzZXQgbXVzdCBiZSBpbiBpc29sYXRpb24gYmVmb3JlIGJlaW5nIGFjdHVhbGx5IGRlbGV0ZWQuXG4gICAqL1xuICByZWFkb25seSByb2xsYmFja0J1ZmZlckRheXM6IG51bWJlcjtcblxuICAvKipcbiAgICogUmVmdXNlIGRlbGV0aW9uIG9mIGFueSBhc3NldHMgeW91bmdlciB0aGFuIHRoaXMgbnVtYmVyIG9mIGRheXMuXG4gICAqL1xuICByZWFkb25seSBjcmVhdGVkQnVmZmVyRGF5czogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgZW52aXJvbm1lbnQgdG8gZGVwbG95IHRoaXMgc3RhY2sgaW5cbiAgICpcbiAgICogVGhlIGVudmlyb25tZW50IG9uIHRoZSBzdGFjayBhcnRpZmFjdCBtYXkgYmUgdW5yZXNvbHZlZCwgdGhpcyBvbmVcbiAgICogbXVzdCBiZSByZXNvbHZlZC5cbiAgICovXG4gIHJlYWRvbmx5IHJlc29sdmVkRW52aXJvbm1lbnQ6IGN4YXBpLkVudmlyb25tZW50O1xuXG4gIC8qKlxuICAgKiBTREsgcHJvdmlkZXIgKHNlZWRlZCB3aXRoIGRlZmF1bHQgY3JlZGVudGlhbHMpXG4gICAqXG4gICAqIFdpbGwgYmUgdXNlZCB0byBtYWtlIFNESyBjYWxscyB0byBDbG91ZEZvcm1hdGlvbiwgUzMsIGFuZCBFQ1IuXG4gICAqL1xuICByZWFkb25seSBzZGtQcm92aWRlcjogU2RrUHJvdmlkZXI7XG5cbiAgLyoqXG4gICAqIFVzZWQgdG8gc2VuZCBtZXNzYWdlcy5cbiAgICovXG4gIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcjtcblxuICAvKipcbiAgICogVGhlIG5hbWUgb2YgdGhlIGJvb3RzdHJhcCBzdGFjayB0byBsb29rIGZvci5cbiAgICpcbiAgICogQGRlZmF1bHQgREVGQVVMVF9UT09MS0lUX1NUQUNLX05BTUVcbiAgICovXG4gIHJlYWRvbmx5IGJvb3RzdHJhcFN0YWNrTmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogQ29uZmlybSB3aXRoIHRoZSB1c2VyIGJlZm9yZSBhY3R1YWwgZGVsZXRpb24gaGFwcGVuc1xuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBjb25maXJtPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBBIGNsYXNzIHRvIGZhY2lsaXRhdGUgR2FyYmFnZSBDb2xsZWN0aW9uIG9mIFMzIGFuZCBFQ1IgYXNzZXRzXG4gKi9cbmV4cG9ydCBjbGFzcyBHYXJiYWdlQ29sbGVjdG9yIHtcbiAgcHJpdmF0ZSBnYXJiYWdlQ29sbGVjdFMzQXNzZXRzOiBib29sZWFuO1xuICBwcml2YXRlIGdhcmJhZ2VDb2xsZWN0RWNyQXNzZXRzOiBib29sZWFuO1xuICBwcml2YXRlIHBlcm1pc3Npb25Ub0RlbGV0ZTogYm9vbGVhbjtcbiAgcHJpdmF0ZSBwZXJtaXNzaW9uVG9UYWc6IGJvb2xlYW47XG4gIHByaXZhdGUgYm9vdHN0cmFwU3RhY2tOYW1lOiBzdHJpbmc7XG4gIHByaXZhdGUgY29uZmlybTogYm9vbGVhbjtcbiAgcHJpdmF0ZSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKHJlYWRvbmx5IHByb3BzOiBHYXJiYWdlQ29sbGVjdG9yUHJvcHMpIHtcbiAgICB0aGlzLmlvSGVscGVyID0gcHJvcHMuaW9IZWxwZXI7XG5cbiAgICB0aGlzLmdhcmJhZ2VDb2xsZWN0UzNBc3NldHMgPSBbJ3MzJywgJ2FsbCddLmluY2x1ZGVzKHByb3BzLnR5cGUpO1xuICAgIHRoaXMuZ2FyYmFnZUNvbGxlY3RFY3JBc3NldHMgPSBbJ2VjcicsICdhbGwnXS5pbmNsdWRlcyhwcm9wcy50eXBlKTtcblxuICAgIHRoaXMucGVybWlzc2lvblRvRGVsZXRlID0gWydkZWxldGUtdGFnZ2VkJywgJ2Z1bGwnXS5pbmNsdWRlcyhwcm9wcy5hY3Rpb24pO1xuICAgIHRoaXMucGVybWlzc2lvblRvVGFnID0gWyd0YWcnLCAnZnVsbCddLmluY2x1ZGVzKHByb3BzLmFjdGlvbik7XG4gICAgdGhpcy5jb25maXJtID0gcHJvcHMuY29uZmlybSA/PyB0cnVlO1xuXG4gICAgdGhpcy5ib290c3RyYXBTdGFja05hbWUgPSBwcm9wcy5ib290c3RyYXBTdGFja05hbWUgPz8gREVGQVVMVF9UT09MS0lUX1NUQUNLX05BTUU7XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybSBnYXJiYWdlIGNvbGxlY3Rpb24gb24gdGhlIHJlc29sdmVkIGVudmlyb25tZW50LlxuICAgKi9cbiAgcHVibGljIGFzeW5jIGdhcmJhZ2VDb2xsZWN0KCkge1xuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYCR7dGhpcy5nYXJiYWdlQ29sbGVjdFMzQXNzZXRzfSAke3RoaXMuZ2FyYmFnZUNvbGxlY3RFY3JBc3NldHN9YCkpO1xuXG4gICAgLy8gU0RLc1xuICAgIGNvbnN0IHNkayA9IChhd2FpdCB0aGlzLnByb3BzLnNka1Byb3ZpZGVyLmZvckVudmlyb25tZW50KHRoaXMucHJvcHMucmVzb2x2ZWRFbnZpcm9ubWVudCwgTW9kZS5Gb3JXcml0aW5nKSkuc2RrO1xuICAgIGNvbnN0IGNmbiA9IHNkay5jbG91ZEZvcm1hdGlvbigpO1xuXG4gICAgY29uc3QgcXVhbGlmaWVyID0gYXdhaXQgdGhpcy5ib290c3RyYXBRdWFsaWZpZXIoc2RrLCB0aGlzLmJvb3RzdHJhcFN0YWNrTmFtZSk7XG4gICAgY29uc3QgYWN0aXZlQXNzZXRzID0gbmV3IEFjdGl2ZUFzc2V0Q2FjaGUoKTtcblxuICAgIC8vIEdyYWIgc3RhY2sgdGVtcGxhdGVzIGZpcnN0XG4gICAgYXdhaXQgcmVmcmVzaFN0YWNrcyhjZm4sIHRoaXMuaW9IZWxwZXIsIGFjdGl2ZUFzc2V0cywgcXVhbGlmaWVyKTtcbiAgICAvLyBTdGFydCB0aGUgYmFja2dyb3VuZCByZWZyZXNoXG4gICAgY29uc3QgYmFja2dyb3VuZFN0YWNrUmVmcmVzaCA9IG5ldyBCYWNrZ3JvdW5kU3RhY2tSZWZyZXNoKHtcbiAgICAgIGNmbixcbiAgICAgIGlvSGVscGVyOiB0aGlzLmlvSGVscGVyLFxuICAgICAgYWN0aXZlQXNzZXRzLFxuICAgICAgcXVhbGlmaWVyLFxuICAgIH0pO1xuICAgIGJhY2tncm91bmRTdGFja1JlZnJlc2guc3RhcnQoKTtcblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5nYXJiYWdlQ29sbGVjdFMzQXNzZXRzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZ2FyYmFnZUNvbGxlY3RTMyhzZGssIGFjdGl2ZUFzc2V0cywgYmFja2dyb3VuZFN0YWNrUmVmcmVzaCk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmdhcmJhZ2VDb2xsZWN0RWNyQXNzZXRzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZ2FyYmFnZUNvbGxlY3RFY3Ioc2RrLCBhY3RpdmVBc3NldHMsIGJhY2tncm91bmRTdGFja1JlZnJlc2gpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGVycik7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGJhY2tncm91bmRTdGFja1JlZnJlc2guc3RvcCgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtIGdhcmJhZ2UgY29sbGVjdGlvbiBvbiBFQ1IgYXNzZXRzXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgZ2FyYmFnZUNvbGxlY3RFY3Ioc2RrOiBTREssIGFjdGl2ZUFzc2V0czogQWN0aXZlQXNzZXRDYWNoZSwgYmFja2dyb3VuZFN0YWNrUmVmcmVzaDogQmFja2dyb3VuZFN0YWNrUmVmcmVzaCkge1xuICAgIGNvbnN0IGVjciA9IHNkay5lY3IoKTtcbiAgICBjb25zdCByZXBvID0gYXdhaXQgdGhpcy5ib290c3RyYXBSZXBvc2l0b3J5TmFtZShzZGssIHRoaXMuYm9vdHN0cmFwU3RhY2tOYW1lKTtcbiAgICBjb25zdCBudW1JbWFnZXMgPSBhd2FpdCB0aGlzLm51bUltYWdlc0luUmVwbyhlY3IsIHJlcG8pO1xuICAgIGNvbnN0IHByaW50ZXIgPSBuZXcgUHJvZ3Jlc3NQcmludGVyKHRoaXMuaW9IZWxwZXIsIG51bUltYWdlcywgMTAwMCk7XG5cbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGBGb3VuZCBib290c3RyYXAgcmVwbyAke3JlcG99IHdpdGggJHtudW1JbWFnZXN9IGltYWdlc2ApKTtcblxuICAgIHRyeSB7XG4gICAgICAvLyBjb25zdCBiYXRjaGVzID0gMTtcbiAgICAgIGNvbnN0IGJhdGNoU2l6ZSA9IDEwMDA7XG4gICAgICBjb25zdCBjdXJyZW50VGltZSA9IERhdGUubm93KCk7XG4gICAgICBjb25zdCBncmFjZURheXMgPSB0aGlzLnByb3BzLnJvbGxiYWNrQnVmZmVyRGF5cztcblxuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgUGFyc2luZyB0aHJvdWdoICR7bnVtSW1hZ2VzfSBpbWFnZXMgaW4gYmF0Y2hlc2ApKTtcblxuICAgICAgcHJpbnRlci5zdGFydCgpO1xuXG4gICAgICBmb3IgYXdhaXQgKGNvbnN0IGJhdGNoIG9mIHRoaXMucmVhZFJlcG9JbkJhdGNoZXMoZWNyLCByZXBvLCBiYXRjaFNpemUsIGN1cnJlbnRUaW1lKSkge1xuICAgICAgICBhd2FpdCBiYWNrZ3JvdW5kU3RhY2tSZWZyZXNoLm5vT2xkZXJUaGFuKDYwMF8wMDApOyAvLyAxMCBtaW5zXG5cbiAgICAgICAgY29uc3QgeyBpbmNsdWRlZDogaXNvbGF0ZWQsIGV4Y2x1ZGVkOiBub3RJc29sYXRlZCB9ID0gcGFydGl0aW9uKGJhdGNoLCBhc3NldCA9PiAhYXNzZXQudGFncy5zb21lKHQgPT4gYWN0aXZlQXNzZXRzLmNvbnRhaW5zKHQpKSk7XG5cbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtpc29sYXRlZC5sZW5ndGh9IGlzb2xhdGVkIGltYWdlc2ApKTtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtub3RJc29sYXRlZC5sZW5ndGh9IG5vdCBpc29sYXRlZCBpbWFnZXNgKSk7XG4gICAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYCR7YmF0Y2gubGVuZ3RofSBpbWFnZXMgdG90YWxgKSk7XG5cbiAgICAgICAgbGV0IGRlbGV0YWJsZXM6IEltYWdlQXNzZXRbXSA9IGlzb2xhdGVkO1xuICAgICAgICBsZXQgdGFnZ2FibGVzOiBJbWFnZUFzc2V0W10gPSBbXTtcbiAgICAgICAgbGV0IHVudGFnZ2FibGVzOiBJbWFnZUFzc2V0W10gPSBbXTtcblxuICAgICAgICBpZiAoZ3JhY2VEYXlzID4gMCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coJ0ZpbHRlcmluZyBvdXQgaW1hZ2VzIHRoYXQgYXJlIG5vdCBvbGQgZW5vdWdoIHRvIGRlbGV0ZScpKTtcblxuICAgICAgICAgIC8vIFdlIGRlbGV0ZSBpbWFnZXMgdGhhdCBhcmUgbm90IHJlZmVyZW5jZWQgaW4gQWN0aXZlQXNzZXRzIGFuZCBoYXZlIHRoZSBJc29sYXRlZCBUYWcgd2l0aCBhIGRhdGVcbiAgICAgICAgICAvLyBlYXJsaWVyIHRoYW4gdGhlIGN1cnJlbnQgdGltZSAtIGdyYWNlIHBlcmlvZC5cbiAgICAgICAgICBkZWxldGFibGVzID0gaXNvbGF0ZWQuZmlsdGVyKGltZyA9PiBpbWcuaXNvbGF0ZWRUYWdCZWZvcmUobmV3IERhdGUoY3VycmVudFRpbWUgLSAoZ3JhY2VEYXlzICogREFZKSkpKTtcblxuICAgICAgICAgIC8vIFdlIHRhZyBpbWFnZXMgdGhhdCBhcmUgbm90IHJlZmVyZW5jZWQgaW4gQWN0aXZlQXNzZXRzIGFuZCBkbyBub3QgaGF2ZSB0aGUgSXNvbGF0ZWQgVGFnLlxuICAgICAgICAgIHRhZ2dhYmxlcyA9IGlzb2xhdGVkLmZpbHRlcihpbWcgPT4gIWltZy5oYXNJc29sYXRlZFRhZygpKTtcblxuICAgICAgICAgIC8vIFdlIHVudGFnIGltYWdlcyB0aGF0IGFyZSByZWZlcmVuY2VkIGluIEFjdGl2ZUFzc2V0cyBhbmQgY3VycmVudGx5IGhhdmUgdGhlIElzb2xhdGVkIFRhZy5cbiAgICAgICAgICB1bnRhZ2dhYmxlcyA9IG5vdElzb2xhdGVkLmZpbHRlcihpbWcgPT4gaW1nLmhhc0lzb2xhdGVkVGFnKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZWxldGFibGVzLmxlbmd0aH0gZGVsZXRhYmxlIGFzc2V0c2ApKTtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHt0YWdnYWJsZXMubGVuZ3RofSB0YWdnYWJsZSBhc3NldHNgKSk7XG4gICAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYCR7dW50YWdnYWJsZXMubGVuZ3RofSBhc3NldHMgdG8gdW50YWdgKSk7XG5cbiAgICAgICAgaWYgKHRoaXMucGVybWlzc2lvblRvRGVsZXRlICYmIGRlbGV0YWJsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuY29uZmlybWF0aW9uUHJvbXB0KHByaW50ZXIsIGRlbGV0YWJsZXMsICdpbWFnZScpO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGFyYWxsZWxEZWxldGVFY3IoZWNyLCByZXBvLCBkZWxldGFibGVzLCBwcmludGVyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLnBlcm1pc3Npb25Ub1RhZyAmJiB0YWdnYWJsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGFyYWxsZWxUYWdFY3IoZWNyLCByZXBvLCB0YWdnYWJsZXMsIHByaW50ZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMucGVybWlzc2lvblRvVGFnICYmIHVudGFnZ2FibGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBhcmFsbGVsVW50YWdFY3IoZWNyLCByZXBvLCB1bnRhZ2dhYmxlcyk7XG4gICAgICAgIH1cblxuICAgICAgICBwcmludGVyLnJlcG9ydFNjYW5uZWRBc3NldChiYXRjaC5sZW5ndGgpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGVycik7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHByaW50ZXIuc3RvcCgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtIGdhcmJhZ2UgY29sbGVjdGlvbiBvbiBTMyBhc3NldHNcbiAgICovXG4gIHB1YmxpYyBhc3luYyBnYXJiYWdlQ29sbGVjdFMzKHNkazogU0RLLCBhY3RpdmVBc3NldHM6IEFjdGl2ZUFzc2V0Q2FjaGUsIGJhY2tncm91bmRTdGFja1JlZnJlc2g6IEJhY2tncm91bmRTdGFja1JlZnJlc2gpIHtcbiAgICBjb25zdCBzMyA9IHNkay5zMygpO1xuICAgIGNvbnN0IGJ1Y2tldCA9IGF3YWl0IHRoaXMuYm9vdHN0cmFwQnVja2V0TmFtZShzZGssIHRoaXMuYm9vdHN0cmFwU3RhY2tOYW1lKTtcbiAgICBjb25zdCBudW1PYmplY3RzID0gYXdhaXQgdGhpcy5udW1PYmplY3RzSW5CdWNrZXQoczMsIGJ1Y2tldCk7XG4gICAgY29uc3QgcHJpbnRlciA9IG5ldyBQcm9ncmVzc1ByaW50ZXIodGhpcy5pb0hlbHBlciwgbnVtT2JqZWN0cywgMTAwMCk7XG5cbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGBGb3VuZCBib290c3RyYXAgYnVja2V0ICR7YnVja2V0fSB3aXRoICR7bnVtT2JqZWN0c30gb2JqZWN0c2ApKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBiYXRjaFNpemUgPSAxMDAwO1xuICAgICAgY29uc3QgY3VycmVudFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgY29uc3QgZ3JhY2VEYXlzID0gdGhpcy5wcm9wcy5yb2xsYmFja0J1ZmZlckRheXM7XG5cbiAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYFBhcnNpbmcgdGhyb3VnaCAke251bU9iamVjdHN9IG9iamVjdHMgaW4gYmF0Y2hlc2ApKTtcblxuICAgICAgcHJpbnRlci5zdGFydCgpO1xuXG4gICAgICAvLyBQcm9jZXNzIG9iamVjdHMgaW4gYmF0Y2hlcyBvZiAxMDAwXG4gICAgICAvLyBUaGlzIGlzIHRoZSBiYXRjaCBsaW1pdCBvZiBzMy5EZWxldGVPYmplY3QgYW5kIHdlIGludGVuZCB0byBvcHRpbWl6ZSBmb3IgdGhlIFwid29yc3QgY2FzZVwiIHNjZW5hcmlvXG4gICAgICAvLyB3aGVyZSBnYyBpcyBydW4gZm9yIHRoZSBmaXJzdCB0aW1lIG9uIGEgbG9uZy1zdGFuZGluZyBidWNrZXQgd2hlcmUgfjEwMCUgb2Ygb2JqZWN0cyBhcmUgaXNvbGF0ZWQuXG4gICAgICBmb3IgYXdhaXQgKGNvbnN0IGJhdGNoIG9mIHRoaXMucmVhZEJ1Y2tldEluQmF0Y2hlcyhzMywgYnVja2V0LCBiYXRjaFNpemUsIGN1cnJlbnRUaW1lKSkge1xuICAgICAgICBhd2FpdCBiYWNrZ3JvdW5kU3RhY2tSZWZyZXNoLm5vT2xkZXJUaGFuKDYwMF8wMDApOyAvLyAxMCBtaW5zXG5cbiAgICAgICAgY29uc3QgeyBpbmNsdWRlZDogaXNvbGF0ZWQsIGV4Y2x1ZGVkOiBub3RJc29sYXRlZCB9ID0gcGFydGl0aW9uKGJhdGNoLCBhc3NldCA9PiAhYWN0aXZlQXNzZXRzLmNvbnRhaW5zKGFzc2V0LmZpbGVOYW1lKCkpKTtcblxuICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGAke2lzb2xhdGVkLmxlbmd0aH0gaXNvbGF0ZWQgYXNzZXRzYCkpO1xuICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGAke25vdElzb2xhdGVkLmxlbmd0aH0gbm90IGlzb2xhdGVkIGFzc2V0c2ApKTtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtiYXRjaC5sZW5ndGh9IG9iamVjdHMgdG90YWxgKSk7XG5cbiAgICAgICAgbGV0IGRlbGV0YWJsZXM6IE9iamVjdEFzc2V0W10gPSBpc29sYXRlZDtcbiAgICAgICAgbGV0IHRhZ2dhYmxlczogT2JqZWN0QXNzZXRbXSA9IFtdO1xuICAgICAgICBsZXQgdW50YWdnYWJsZXM6IE9iamVjdEFzc2V0W10gPSBbXTtcblxuICAgICAgICBpZiAoZ3JhY2VEYXlzID4gMCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coJ0ZpbHRlcmluZyBvdXQgYXNzZXRzIHRoYXQgYXJlIG5vdCBvbGQgZW5vdWdoIHRvIGRlbGV0ZScpKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBhcmFsbGVsUmVhZEFsbFRhZ3MoczMsIGJhdGNoKTtcblxuICAgICAgICAgIC8vIFdlIGRlbGV0ZSBvYmplY3RzIHRoYXQgYXJlIG5vdCByZWZlcmVuY2VkIGluIEFjdGl2ZUFzc2V0cyBhbmQgaGF2ZSB0aGUgSXNvbGF0ZWQgVGFnIHdpdGggYSBkYXRlXG4gICAgICAgICAgLy8gZWFybGllciB0aGFuIHRoZSBjdXJyZW50IHRpbWUgLSBncmFjZSBwZXJpb2QuXG4gICAgICAgICAgZGVsZXRhYmxlcyA9IGlzb2xhdGVkLmZpbHRlcihvYmogPT4gb2JqLmlzb2xhdGVkVGFnQmVmb3JlKG5ldyBEYXRlKGN1cnJlbnRUaW1lIC0gKGdyYWNlRGF5cyAqIERBWSkpKSk7XG5cbiAgICAgICAgICAvLyBXZSB0YWcgb2JqZWN0cyB0aGF0IGFyZSBub3QgcmVmZXJlbmNlZCBpbiBBY3RpdmVBc3NldHMgYW5kIGRvIG5vdCBoYXZlIHRoZSBJc29sYXRlZCBUYWcuXG4gICAgICAgICAgdGFnZ2FibGVzID0gaXNvbGF0ZWQuZmlsdGVyKG9iaiA9PiAhb2JqLmhhc0lzb2xhdGVkVGFnKCkpO1xuXG4gICAgICAgICAgLy8gV2UgdW50YWcgb2JqZWN0cyB0aGF0IGFyZSByZWZlcmVuY2VkIGluIEFjdGl2ZUFzc2V0cyBhbmQgY3VycmVudGx5IGhhdmUgdGhlIElzb2xhdGVkIFRhZy5cbiAgICAgICAgICB1bnRhZ2dhYmxlcyA9IG5vdElzb2xhdGVkLmZpbHRlcihvYmogPT4gb2JqLmhhc0lzb2xhdGVkVGFnKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZWxldGFibGVzLmxlbmd0aH0gZGVsZXRhYmxlIGFzc2V0c2ApKTtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHt0YWdnYWJsZXMubGVuZ3RofSB0YWdnYWJsZSBhc3NldHNgKSk7XG4gICAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYCR7dW50YWdnYWJsZXMubGVuZ3RofSBhc3NldHMgdG8gdW50YWdgKSk7XG5cbiAgICAgICAgaWYgKHRoaXMucGVybWlzc2lvblRvRGVsZXRlICYmIGRlbGV0YWJsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuY29uZmlybWF0aW9uUHJvbXB0KHByaW50ZXIsIGRlbGV0YWJsZXMsICdvYmplY3QnKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBhcmFsbGVsRGVsZXRlUzMoczMsIGJ1Y2tldCwgZGVsZXRhYmxlcywgcHJpbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5wZXJtaXNzaW9uVG9UYWcgJiYgdGFnZ2FibGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBhcmFsbGVsVGFnUzMoczMsIGJ1Y2tldCwgdGFnZ2FibGVzLCBjdXJyZW50VGltZSwgcHJpbnRlcik7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5wZXJtaXNzaW9uVG9UYWcgJiYgdW50YWdnYWJsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGFyYWxsZWxVbnRhZ1MzKHMzLCBidWNrZXQsIHVudGFnZ2FibGVzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHByaW50ZXIucmVwb3J0U2Nhbm5lZEFzc2V0KGJhdGNoLmxlbmd0aCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoZXJyKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcHJpbnRlci5zdG9wKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwYXJhbGxlbFJlYWRBbGxUYWdzKHMzOiBJUzNDbGllbnQsIG9iamVjdHM6IE9iamVjdEFzc2V0W10pIHtcbiAgICBjb25zdCBsaW1pdCA9IHBMaW1pdChQX0xJTUlUKTtcblxuICAgIGZvciAoY29uc3Qgb2JqIG9mIG9iamVjdHMpIHtcbiAgICAgIGF3YWl0IGxpbWl0KCgpID0+IG9iai5hbGxUYWdzKHMzKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVudGFnIGFzc2V0cyB0aGF0IHdlcmUgcHJldmlvdXNseSB0YWdnZWQsIGJ1dCBub3cgY3VycmVudGx5IHJlZmVyZW5jZWQuXG4gICAqIFNpbmNlIHRoaXMgaXMgdHJlYXRlZCBhcyBhbiBpbXBsZW1lbnRhdGlvbiBkZXRhaWwsIHdlIGRvIG5vdCBwcmludCB0aGUgcmVzdWx0cyBpbiB0aGUgcHJpbnRlci5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcGFyYWxsZWxVbnRhZ0VjcihlY3I6IElFQ1JDbGllbnQsIHJlcG86IHN0cmluZywgdW50YWdnYWJsZXM6IEltYWdlQXNzZXRbXSkge1xuICAgIGNvbnN0IGxpbWl0ID0gcExpbWl0KFBfTElNSVQpO1xuXG4gICAgZm9yIChjb25zdCBpbWcgb2YgdW50YWdnYWJsZXMpIHtcbiAgICAgIGNvbnN0IHRhZyA9IGltZy5nZXRJc29sYXRlZFRhZygpO1xuICAgICAgYXdhaXQgbGltaXQoKCkgPT5cbiAgICAgICAgZWNyLmJhdGNoRGVsZXRlSW1hZ2Uoe1xuICAgICAgICAgIHJlcG9zaXRvcnlOYW1lOiByZXBvLFxuICAgICAgICAgIGltYWdlSWRzOiBbe1xuICAgICAgICAgICAgaW1hZ2VUYWc6IHRhZyxcbiAgICAgICAgICB9XSxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYFVudGFnZ2VkICR7dW50YWdnYWJsZXMubGVuZ3RofSBhc3NldHNgKSk7XG4gIH1cblxuICAvKipcbiAgICogVW50YWcgYXNzZXRzIHRoYXQgd2VyZSBwcmV2aW91c2x5IHRhZ2dlZCwgYnV0IG5vdyBjdXJyZW50bHkgcmVmZXJlbmNlZC5cbiAgICogU2luY2UgdGhpcyBpcyB0cmVhdGVkIGFzIGFuIGltcGxlbWVudGF0aW9uIGRldGFpbCwgd2UgZG8gbm90IHByaW50IHRoZSByZXN1bHRzIGluIHRoZSBwcmludGVyLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwYXJhbGxlbFVudGFnUzMoczM6IElTM0NsaWVudCwgYnVja2V0OiBzdHJpbmcsIHVudGFnZ2FibGVzOiBPYmplY3RBc3NldFtdKSB7XG4gICAgY29uc3QgbGltaXQgPSBwTGltaXQoUF9MSU1JVCk7XG5cbiAgICBmb3IgKGNvbnN0IG9iaiBvZiB1bnRhZ2dhYmxlcykge1xuICAgICAgY29uc3QgdGFncyA9IGF3YWl0IG9iai5hbGxUYWdzKHMzKSA/PyBbXTtcbiAgICAgIGNvbnN0IHVwZGF0ZWRUYWdzID0gdGFncy5maWx0ZXIoKHRhZzogVGFnKSA9PiB0YWcuS2V5ICE9PSBTM19JU09MQVRFRF9UQUcpO1xuICAgICAgYXdhaXQgbGltaXQoKCkgPT5cbiAgICAgICAgczMuZGVsZXRlT2JqZWN0VGFnZ2luZyh7XG4gICAgICAgICAgQnVja2V0OiBidWNrZXQsXG4gICAgICAgICAgS2V5OiBvYmoua2V5LFxuXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICAgIGF3YWl0IGxpbWl0KCgpID0+XG4gICAgICAgIHMzLnB1dE9iamVjdFRhZ2dpbmcoe1xuICAgICAgICAgIEJ1Y2tldDogYnVja2V0LFxuICAgICAgICAgIEtleTogb2JqLmtleSxcbiAgICAgICAgICBUYWdnaW5nOiB7XG4gICAgICAgICAgICBUYWdTZXQ6IHVwZGF0ZWRUYWdzLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGBVbnRhZ2dlZCAke3VudGFnZ2FibGVzLmxlbmd0aH0gYXNzZXRzYCkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRhZyBpbWFnZXMgaW4gcGFyYWxsZWwgdXNpbmcgcC1saW1pdFxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwYXJhbGxlbFRhZ0VjcihlY3I6IElFQ1JDbGllbnQsIHJlcG86IHN0cmluZywgdGFnZ2FibGVzOiBJbWFnZUFzc2V0W10sIHByaW50ZXI6IFByb2dyZXNzUHJpbnRlcikge1xuICAgIGNvbnN0IGxpbWl0ID0gcExpbWl0KFBfTElNSVQpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0YWdnYWJsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGltZyA9IHRhZ2dhYmxlc1tpXTtcbiAgICAgIGNvbnN0IHRhZ0VjciA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBlY3IucHV0SW1hZ2Uoe1xuICAgICAgICAgICAgcmVwb3NpdG9yeU5hbWU6IHJlcG8sXG4gICAgICAgICAgICBpbWFnZURpZ2VzdDogaW1nLmRpZ2VzdCxcbiAgICAgICAgICAgIGltYWdlTWFuaWZlc3Q6IGltZy5tYW5pZmVzdCxcbiAgICAgICAgICAgIGltYWdlVGFnOiBpbWcuYnVpbGRJbWFnZVRhZyhpKSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAvLyBUaGlzIGlzIGEgZmFsc2UgbmVnYXRpdmUgLS0gYW4gaXNvbGF0ZWQgYXNzZXQgaXMgdW50YWdnZWRcbiAgICAgICAgICAvLyBsaWtlbHkgZHVlIHRvIGFuIGltYWdlVGFnIGNvbGxpc2lvbi4gV2UgY2FuIHNhZmVseSBpZ25vcmUsXG4gICAgICAgICAgLy8gYW5kIHRoZSBpc29sYXRlZCBhc3NldCB3aWxsIGJlIHRhZ2dlZCBuZXh0IHRpbWUuXG4gICAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgV2FybmluZzogdW5hYmxlIHRvIHRhZyBpbWFnZSAke0pTT04uc3RyaW5naWZ5KGltZy50YWdzKX0gd2l0aCAke2ltZy5idWlsZEltYWdlVGFnKGkpfSBkdWUgdG8gdGhlIGZvbGxvd2luZyBlcnJvcjogJHtlcnJvcn1gKSk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBhd2FpdCBsaW1pdCgoKSA9PiB0YWdFY3IoKSk7XG4gICAgfVxuXG4gICAgcHJpbnRlci5yZXBvcnRUYWdnZWRBc3NldCh0YWdnYWJsZXMpO1xuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYFRhZ2dlZCAke3RhZ2dhYmxlcy5sZW5ndGh9IGFzc2V0c2ApKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUYWcgb2JqZWN0cyBpbiBwYXJhbGxlbCB1c2luZyBwLWxpbWl0LiBUaGUgcHV0T2JqZWN0VGFnZ2luZyBBUEkgZG9lcyBub3RcbiAgICogc3VwcG9ydCBiYXRjaCB0YWdnaW5nIHNvIHdlIG11c3QgaGFuZGxlIHRoZSBwYXJhbGxlbGlzbSBjbGllbnQtc2lkZS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcGFyYWxsZWxUYWdTMyhzMzogSVMzQ2xpZW50LCBidWNrZXQ6IHN0cmluZywgdGFnZ2FibGVzOiBPYmplY3RBc3NldFtdLCBkYXRlOiBudW1iZXIsIHByaW50ZXI6IFByb2dyZXNzUHJpbnRlcikge1xuICAgIGNvbnN0IGxpbWl0ID0gcExpbWl0KFBfTElNSVQpO1xuXG4gICAgZm9yIChjb25zdCBvYmogb2YgdGFnZ2FibGVzKSB7XG4gICAgICBhd2FpdCBsaW1pdCgoKSA9PlxuICAgICAgICBzMy5wdXRPYmplY3RUYWdnaW5nKHtcbiAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldCxcbiAgICAgICAgICBLZXk6IG9iai5rZXksXG4gICAgICAgICAgVGFnZ2luZzoge1xuICAgICAgICAgICAgVGFnU2V0OiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBLZXk6IFMzX0lTT0xBVEVEX1RBRyxcbiAgICAgICAgICAgICAgICBWYWx1ZTogU3RyaW5nKGRhdGUpLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcHJpbnRlci5yZXBvcnRUYWdnZWRBc3NldCh0YWdnYWJsZXMpO1xuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYFRhZ2dlZCAke3RhZ2dhYmxlcy5sZW5ndGh9IGFzc2V0c2ApKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGUgaW1hZ2VzIGluIHBhcmFsbGVsLiBUaGUgZGVsZXRlSW1hZ2UgQVBJIHN1cHBvcnRzIGJhdGNoZXMgb2YgMTAwLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwYXJhbGxlbERlbGV0ZUVjcihlY3I6IElFQ1JDbGllbnQsIHJlcG86IHN0cmluZywgZGVsZXRhYmxlczogSW1hZ2VBc3NldFtdLCBwcmludGVyOiBQcm9ncmVzc1ByaW50ZXIpIHtcbiAgICBjb25zdCBiYXRjaFNpemUgPSAxMDA7XG4gICAgY29uc3QgaW1hZ2VzVG9EZWxldGUgPSBkZWxldGFibGVzLm1hcChpbWcgPT4gKHtcbiAgICAgIGltYWdlRGlnZXN0OiBpbWcuZGlnZXN0LFxuICAgIH0pKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBiYXRjaGVzID0gW107XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGltYWdlc1RvRGVsZXRlLmxlbmd0aDsgaSArPSBiYXRjaFNpemUpIHtcbiAgICAgICAgYmF0Y2hlcy5wdXNoKGltYWdlc1RvRGVsZXRlLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpKTtcbiAgICAgIH1cbiAgICAgIC8vIERlbGV0ZSBpbWFnZXMgaW4gYmF0Y2hlc1xuICAgICAgZm9yIChjb25zdCBiYXRjaCBvZiBiYXRjaGVzKSB7XG4gICAgICAgIGF3YWl0IGVjci5iYXRjaERlbGV0ZUltYWdlKHtcbiAgICAgICAgICBpbWFnZUlkczogYmF0Y2gsXG4gICAgICAgICAgcmVwb3NpdG9yeU5hbWU6IHJlcG8sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGRlbGV0ZWRDb3VudCA9IGJhdGNoLmxlbmd0aDtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgRGVsZXRlZCAke2RlbGV0ZWRDb3VudH0gYXNzZXRzYCkpO1xuICAgICAgICBwcmludGVyLnJlcG9ydERlbGV0ZWRBc3NldChkZWxldGFibGVzLnNsaWNlKDAsIGRlbGV0ZWRDb3VudCkpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0VSUk9SLm1zZyhgRXJyb3IgZGVsZXRpbmcgaW1hZ2VzOiAke2Vycn1gKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSBvYmplY3RzIGluIHBhcmFsbGVsLiBUaGUgZGVsZXRlT2JqZWN0cyBBUEkgc3VwcG9ydHMgYmF0Y2hlcyBvZiAxMDAwLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwYXJhbGxlbERlbGV0ZVMzKHMzOiBJUzNDbGllbnQsIGJ1Y2tldDogc3RyaW5nLCBkZWxldGFibGVzOiBPYmplY3RBc3NldFtdLCBwcmludGVyOiBQcm9ncmVzc1ByaW50ZXIpIHtcbiAgICBjb25zdCBiYXRjaFNpemUgPSAxMDAwO1xuICAgIGNvbnN0IG9iamVjdHNUb0RlbGV0ZSA9IGRlbGV0YWJsZXMubWFwKGFzc2V0ID0+ICh7XG4gICAgICBLZXk6IGFzc2V0LmtleSxcbiAgICB9KSk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgYmF0Y2hlcyA9IFtdO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBvYmplY3RzVG9EZWxldGUubGVuZ3RoOyBpICs9IGJhdGNoU2l6ZSkge1xuICAgICAgICBiYXRjaGVzLnB1c2gob2JqZWN0c1RvRGVsZXRlLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpKTtcbiAgICAgIH1cbiAgICAgIC8vIERlbGV0ZSBvYmplY3RzIGluIGJhdGNoZXNcbiAgICAgIGZvciAoY29uc3QgYmF0Y2ggb2YgYmF0Y2hlcykge1xuICAgICAgICBhd2FpdCBzMy5kZWxldGVPYmplY3RzKHtcbiAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldCxcbiAgICAgICAgICBEZWxldGU6IHtcbiAgICAgICAgICAgIE9iamVjdHM6IGJhdGNoLFxuICAgICAgICAgICAgUXVpZXQ6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgZGVsZXRlZENvdW50ID0gYmF0Y2gubGVuZ3RoO1xuICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGBEZWxldGVkICR7ZGVsZXRlZENvdW50fSBhc3NldHNgKSk7XG4gICAgICAgIHByaW50ZXIucmVwb3J0RGVsZXRlZEFzc2V0KGRlbGV0YWJsZXMuc2xpY2UoMCwgZGVsZXRlZENvdW50KSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGNoYWxrLnJlZChgRXJyb3IgZGVsZXRpbmcgb2JqZWN0czogJHtlcnJ9YCkpKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGJvb3RzdHJhcEJ1Y2tldE5hbWUoc2RrOiBTREssIGJvb3RzdHJhcFN0YWNrTmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCB0b29sa2l0SW5mbyA9IGF3YWl0IFRvb2xraXRJbmZvLmxvb2t1cCh0aGlzLnByb3BzLnJlc29sdmVkRW52aXJvbm1lbnQsIHNkaywgdGhpcy5pb0hlbHBlciwgYm9vdHN0cmFwU3RhY2tOYW1lKTtcbiAgICByZXR1cm4gdG9vbGtpdEluZm8uYnVja2V0TmFtZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYm9vdHN0cmFwUmVwb3NpdG9yeU5hbWUoc2RrOiBTREssIGJvb3RzdHJhcFN0YWNrTmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCB0b29sa2l0SW5mbyA9IGF3YWl0IFRvb2xraXRJbmZvLmxvb2t1cCh0aGlzLnByb3BzLnJlc29sdmVkRW52aXJvbm1lbnQsIHNkaywgdGhpcy5pb0hlbHBlciwgYm9vdHN0cmFwU3RhY2tOYW1lKTtcbiAgICByZXR1cm4gdG9vbGtpdEluZm8ucmVwb3NpdG9yeU5hbWU7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGJvb3RzdHJhcFF1YWxpZmllcihzZGs6IFNESywgYm9vdHN0cmFwU3RhY2tOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IHRvb2xraXRJbmZvID0gYXdhaXQgVG9vbGtpdEluZm8ubG9va3VwKHRoaXMucHJvcHMucmVzb2x2ZWRFbnZpcm9ubWVudCwgc2RrLCB0aGlzLmlvSGVscGVyLCBib290c3RyYXBTdGFja05hbWUpO1xuICAgIHJldHVybiB0b29sa2l0SW5mby5ib290c3RyYXBTdGFjay5wYXJhbWV0ZXJzLlF1YWxpZmllcjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbnVtT2JqZWN0c0luQnVja2V0KHMzOiBJUzNDbGllbnQsIGJ1Y2tldDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBsZXQgdG90YWxDb3VudCA9IDA7XG4gICAgbGV0IGNvbnRpbnVhdGlvblRva2VuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgICBkbyB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHMzLmxpc3RPYmplY3RzVjIoe1xuICAgICAgICBCdWNrZXQ6IGJ1Y2tldCxcbiAgICAgICAgQ29udGludWF0aW9uVG9rZW46IGNvbnRpbnVhdGlvblRva2VuLFxuICAgICAgfSk7XG5cbiAgICAgIHRvdGFsQ291bnQgKz0gcmVzcG9uc2UuS2V5Q291bnQgPz8gMDtcbiAgICAgIGNvbnRpbnVhdGlvblRva2VuID0gcmVzcG9uc2UuTmV4dENvbnRpbnVhdGlvblRva2VuO1xuICAgIH0gd2hpbGUgKGNvbnRpbnVhdGlvblRva2VuKTtcblxuICAgIHJldHVybiB0b3RhbENvdW50O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBudW1JbWFnZXNJblJlcG8oZWNyOiBJRUNSQ2xpZW50LCByZXBvOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGxldCB0b3RhbENvdW50ID0gMDtcbiAgICBsZXQgbmV4dFRva2VuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgICBkbyB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGVjci5saXN0SW1hZ2VzKHtcbiAgICAgICAgcmVwb3NpdG9yeU5hbWU6IHJlcG8sXG4gICAgICAgIG5leHRUb2tlbjogbmV4dFRva2VuLFxuICAgICAgfSk7XG5cbiAgICAgIHRvdGFsQ291bnQgKz0gcmVzcG9uc2UuaW1hZ2VJZHM/Lmxlbmd0aCA/PyAwO1xuICAgICAgbmV4dFRva2VuID0gcmVzcG9uc2UubmV4dFRva2VuO1xuICAgIH0gd2hpbGUgKG5leHRUb2tlbik7XG5cbiAgICByZXR1cm4gdG90YWxDb3VudDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgKnJlYWRSZXBvSW5CYXRjaGVzKGVjcjogSUVDUkNsaWVudCwgcmVwbzogc3RyaW5nLCBiYXRjaFNpemU6IG51bWJlciA9IDEwMDAsIGN1cnJlbnRUaW1lOiBudW1iZXIpOiBBc3luY0dlbmVyYXRvcjxJbWFnZUFzc2V0W10+IHtcbiAgICBsZXQgY29udGludWF0aW9uVG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICAgIGRvIHtcbiAgICAgIGNvbnN0IGJhdGNoOiBJbWFnZUFzc2V0W10gPSBbXTtcblxuICAgICAgd2hpbGUgKGJhdGNoLmxlbmd0aCA8IGJhdGNoU2l6ZSkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGVjci5saXN0SW1hZ2VzKHtcbiAgICAgICAgICByZXBvc2l0b3J5TmFtZTogcmVwbyxcbiAgICAgICAgICBuZXh0VG9rZW46IGNvbnRpbnVhdGlvblRva2VuLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBObyBpbWFnZXMgaW4gdGhlIHJlcG9zaXRvcnlcbiAgICAgICAgaWYgKCFyZXNwb25zZS5pbWFnZUlkcyB8fCByZXNwb25zZS5pbWFnZUlkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG1hcCB1bmlxdWUgaW1hZ2UgZGlnZXN0IHRvIChwb3NzaWJseSBtdWx0aXBsZSkgdGFnc1xuICAgICAgICBjb25zdCBpbWFnZXMgPSBpbWFnZU1hcChyZXNwb25zZS5pbWFnZUlkcyA/PyBbXSk7XG5cbiAgICAgICAgY29uc3QgaW1hZ2VJZHMgPSBPYmplY3Qua2V5cyhpbWFnZXMpLm1hcChrZXkgPT4gKHtcbiAgICAgICAgICBpbWFnZURpZ2VzdDoga2V5LFxuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc3QgZGVzY3JpYmVJbWFnZUluZm8gPSBhd2FpdCBlY3IuZGVzY3JpYmVJbWFnZXMoe1xuICAgICAgICAgIHJlcG9zaXRvcnlOYW1lOiByZXBvLFxuICAgICAgICAgIGltYWdlSWRzOiBpbWFnZUlkcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgZ2V0SW1hZ2VJbmZvID0gYXdhaXQgZWNyLmJhdGNoR2V0SW1hZ2Uoe1xuICAgICAgICAgIHJlcG9zaXRvcnlOYW1lOiByZXBvLFxuICAgICAgICAgIGltYWdlSWRzOiBpbWFnZUlkcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgY29tYmluZWRJbWFnZUluZm8gPSBkZXNjcmliZUltYWdlSW5mby5pbWFnZURldGFpbHM/Lm1hcChpbWFnZURldGFpbCA9PiB7XG4gICAgICAgICAgY29uc3QgbWF0Y2hpbmdJbWFnZSA9IGdldEltYWdlSW5mby5pbWFnZXM/LmZpbmQoXG4gICAgICAgICAgICBpbWcgPT4gaW1nLmltYWdlSWQ/LmltYWdlRGlnZXN0ID09PSBpbWFnZURldGFpbC5pbWFnZURpZ2VzdCxcbiAgICAgICAgICApO1xuXG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLmltYWdlRGV0YWlsLFxuICAgICAgICAgICAgbWFuaWZlc3Q6IG1hdGNoaW5nSW1hZ2U/LmltYWdlTWFuaWZlc3QsXG4gICAgICAgICAgfTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBjb21iaW5lZEltYWdlSW5mbyA/PyBbXSkge1xuICAgICAgICAgIGNvbnN0IGxhc3RNb2RpZmllZCA9IGltYWdlLmltYWdlUHVzaGVkQXQgPz8gbmV3IERhdGUoY3VycmVudFRpbWUpO1xuICAgICAgICAgIC8vIFN0b3JlIHRoZSBpbWFnZSBpZiBpdCB3YXMgcHVzaGVkIGVhcmxpZXIgdGhhbiB0b2RheSAtIGNyZWF0ZWRCdWZmZXJEYXlzXG4gICAgICAgICAgaWYgKGltYWdlLmltYWdlRGlnZXN0ICYmIGxhc3RNb2RpZmllZCA8IG5ldyBEYXRlKGN1cnJlbnRUaW1lIC0gKHRoaXMucHJvcHMuY3JlYXRlZEJ1ZmZlckRheXMgKiBEQVkpKSkge1xuICAgICAgICAgICAgYmF0Y2gucHVzaChuZXcgSW1hZ2VBc3NldChpbWFnZS5pbWFnZURpZ2VzdCwgaW1hZ2UuaW1hZ2VTaXplSW5CeXRlcyA/PyAwLCBpbWFnZS5pbWFnZVRhZ3MgPz8gW10sIGltYWdlLm1hbmlmZXN0ID8/ICcnKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWF0aW9uVG9rZW4gPSByZXNwb25zZS5uZXh0VG9rZW47XG5cbiAgICAgICAgaWYgKCFjb250aW51YXRpb25Ub2tlbikgYnJlYWs7IC8vIE5vIG1vcmUgaW1hZ2VzIHRvIGZldGNoXG4gICAgICB9XG5cbiAgICAgIGlmIChiYXRjaC5sZW5ndGggPiAwKSB7XG4gICAgICAgIHlpZWxkIGJhdGNoO1xuICAgICAgfVxuICAgIH0gd2hpbGUgKGNvbnRpbnVhdGlvblRva2VuKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0b3IgZnVuY3Rpb24gdGhhdCByZWFkcyBvYmplY3RzIGZyb20gdGhlIFMzIEJ1Y2tldCBpbiBiYXRjaGVzLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyAqcmVhZEJ1Y2tldEluQmF0Y2hlcyhzMzogSVMzQ2xpZW50LCBidWNrZXQ6IHN0cmluZywgYmF0Y2hTaXplOiBudW1iZXIgPSAxMDAwLCBjdXJyZW50VGltZTogbnVtYmVyKTogQXN5bmNHZW5lcmF0b3I8T2JqZWN0QXNzZXRbXT4ge1xuICAgIGxldCBjb250aW51YXRpb25Ub2tlbjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgZG8ge1xuICAgICAgY29uc3QgYmF0Y2g6IE9iamVjdEFzc2V0W10gPSBbXTtcblxuICAgICAgd2hpbGUgKGJhdGNoLmxlbmd0aCA8IGJhdGNoU2l6ZSkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHMzLmxpc3RPYmplY3RzVjIoe1xuICAgICAgICAgIEJ1Y2tldDogYnVja2V0LFxuICAgICAgICAgIENvbnRpbnVhdGlvblRva2VuOiBjb250aW51YXRpb25Ub2tlbixcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVzcG9uc2UuQ29udGVudHM/LmZvckVhY2goKG9iajogYW55KSA9PiB7XG4gICAgICAgICAgY29uc3Qga2V5ID0gb2JqLktleSA/PyAnJztcbiAgICAgICAgICBjb25zdCBzaXplID0gb2JqLlNpemUgPz8gMDtcbiAgICAgICAgICBjb25zdCBsYXN0TW9kaWZpZWQgPSBvYmouTGFzdE1vZGlmaWVkID8/IG5ldyBEYXRlKGN1cnJlbnRUaW1lKTtcbiAgICAgICAgICAvLyBTdG9yZSB0aGUgb2JqZWN0IGlmIGl0IGhhcyBhIEtleSBhbmRcbiAgICAgICAgICAvLyBpZiBpdCBoYXMgbm90IGJlZW4gbW9kaWZpZWQgc2luY2UgdG9kYXkgLSBjcmVhdGVkQnVmZmVyRGF5c1xuICAgICAgICAgIGlmIChrZXkgJiYgbGFzdE1vZGlmaWVkIDwgbmV3IERhdGUoY3VycmVudFRpbWUgLSAodGhpcy5wcm9wcy5jcmVhdGVkQnVmZmVyRGF5cyAqIERBWSkpKSB7XG4gICAgICAgICAgICBiYXRjaC5wdXNoKG5ldyBPYmplY3RBc3NldChidWNrZXQsIGtleSwgc2l6ZSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29udGludWF0aW9uVG9rZW4gPSByZXNwb25zZS5OZXh0Q29udGludWF0aW9uVG9rZW47XG5cbiAgICAgICAgaWYgKCFjb250aW51YXRpb25Ub2tlbikgYnJlYWs7IC8vIE5vIG1vcmUgb2JqZWN0cyB0byBmZXRjaFxuICAgICAgfVxuXG4gICAgICBpZiAoYmF0Y2gubGVuZ3RoID4gMCkge1xuICAgICAgICB5aWVsZCBiYXRjaDtcbiAgICAgIH1cbiAgICB9IHdoaWxlIChjb250aW51YXRpb25Ub2tlbik7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvbmZpcm1hdGlvblByb21wdChwcmludGVyOiBQcm9ncmVzc1ByaW50ZXIsIGRlbGV0YWJsZXM6IEdjQXNzZXRbXSwgdHlwZTogc3RyaW5nKSB7XG4gICAgY29uc3QgcGx1cmFsaXplID0gKG5hbWU6IHN0cmluZywgY291bnQ6IG51bWJlcik6IHN0cmluZyA9PiB7XG4gICAgICByZXR1cm4gY291bnQgPT09IDEgPyBuYW1lIDogYCR7bmFtZX1zYDtcbiAgICB9O1xuXG4gICAgaWYgKHRoaXMuY29uZmlybSkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IFtcbiAgICAgICAgYEZvdW5kICR7ZGVsZXRhYmxlcy5sZW5ndGh9ICR7cGx1cmFsaXplKHR5cGUsIGRlbGV0YWJsZXMubGVuZ3RoKX0gdG8gZGVsZXRlIGJhc2VkIG9mZiBvZiB0aGUgZm9sbG93aW5nIGNyaXRlcmlhOmAsXG4gICAgICAgIGAtICR7dHlwZX1zIGhhdmUgYmVlbiBpc29sYXRlZCBmb3IgPiAke3RoaXMucHJvcHMucm9sbGJhY2tCdWZmZXJEYXlzfSBkYXlzYCxcbiAgICAgICAgYC0gJHt0eXBlfXMgd2VyZSBjcmVhdGVkID4gJHt0aGlzLnByb3BzLmNyZWF0ZWRCdWZmZXJEYXlzfSBkYXlzIGFnb2AsXG4gICAgICAgICcnLFxuICAgICAgICAnRGVsZXRlIHRoaXMgYmF0Y2ggKHllcy9uby9kZWxldGUtYWxsKT8nLFxuICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICAgIHByaW50ZXIucGF1c2UoKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcHJvbXB0bHkucHJvbXB0KG1lc3NhZ2UsXG4gICAgICAgIHsgdHJpbTogdHJ1ZSB9LFxuICAgICAgKTtcblxuICAgICAgLy8gQW55dGhpbmcgb3RoZXIgdGhhbiB5ZXMveS9kZWxldGUtYWxsIGlzIHRyZWF0ZWQgYXMgbm9cbiAgICAgIGlmICghcmVzcG9uc2UgfHwgIVsneWVzJywgJ3knLCAnZGVsZXRlLWFsbCddLmluY2x1ZGVzKHJlc3BvbnNlLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJ0RlbGV0aW9uIGFib3J0ZWQgYnkgdXNlcicpO1xuICAgICAgfSBlbHNlIGlmIChyZXNwb25zZS50b0xvd2VyQ2FzZSgpID09ICdkZWxldGUtYWxsJykge1xuICAgICAgICB0aGlzLmNvbmZpcm0gPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcHJpbnRlci5yZXN1bWUoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJ0aXRpb248QT4oeHM6IEl0ZXJhYmxlPEE+LCBwcmVkOiAoeDogQSkgPT4gYm9vbGVhbik6IHsgaW5jbHVkZWQ6IEFbXTsgZXhjbHVkZWQ6IEFbXSB9IHtcbiAgY29uc3QgcmVzdWx0ID0ge1xuICAgIGluY2x1ZGVkOiBbXSBhcyBBW10sXG4gICAgZXhjbHVkZWQ6IFtdIGFzIEFbXSxcbiAgfTtcblxuICBmb3IgKGNvbnN0IHggb2YgeHMpIHtcbiAgICBpZiAocHJlZCh4KSkge1xuICAgICAgcmVzdWx0LmluY2x1ZGVkLnB1c2goeCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5leGNsdWRlZC5wdXNoKHgpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGltYWdlTWFwKGltYWdlSWRzOiBJbWFnZUlkZW50aWZpZXJbXSkge1xuICBjb25zdCBpbWFnZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiA9IHt9O1xuICBmb3IgKGNvbnN0IGltYWdlIG9mIGltYWdlSWRzID8/IFtdKSB7XG4gICAgaWYgKCFpbWFnZS5pbWFnZURpZ2VzdCB8fCAhaW1hZ2UuaW1hZ2VUYWcpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoIWltYWdlc1tpbWFnZS5pbWFnZURpZ2VzdF0pIHtcbiAgICAgIGltYWdlc1tpbWFnZS5pbWFnZURpZ2VzdF0gPSBbXTtcbiAgICB9XG4gICAgaW1hZ2VzW2ltYWdlLmltYWdlRGlnZXN0XS5wdXNoKGltYWdlLmltYWdlVGFnKTtcbiAgfVxuICByZXR1cm4gaW1hZ2VzO1xufVxuIl19