import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { FileAssetPackaging, FileSource } from '@aws-cdk/cloud-assembly-schema';
import * as mime from 'mime';
import { destinationToClientOptions } from './client-options';
import { FileManifestEntry } from '../../asset-manifest';
import { IS3Client } from '../../aws';
import { PutObjectCommandInput } from '../../aws-types';
import { EventType, shellEventPublisherFromEventEmitter } from '../../progress';
import { zipDirectory } from '../archive';
import { IAssetHandler, IHandlerHost, type PublishOptions } from '../asset-handler';
import { pathExists } from '../fs-extra';
import { replaceAwsPlaceholders } from '../placeholders';
import { shell } from '../shell';

/**
 * The size of an empty zip file is 22 bytes
 *
 * Ref: https://en.wikipedia.org/wiki/ZIP_(file_format)
 */
const EMPTY_ZIP_FILE_SIZE = 22;

export class FileAssetHandler implements IAssetHandler {
  private readonly fileCacheRoot: string;

  constructor(
    private readonly workDir: string,
    private readonly asset: FileManifestEntry,
    private readonly host: IHandlerHost,
  ) {
    this.fileCacheRoot = path.join(workDir, '.cache');
  }

  public async build(): Promise<void> {
  }

  public async isPublished(): Promise<boolean> {
    const destination = await replaceAwsPlaceholders(this.asset.destination, this.host.aws);
    const s3Url = `s3://${destination.bucketName}/${destination.objectKey}`;
    try {
      const s3 = await this.host.aws.s3Client({
        ...destinationToClientOptions(destination),
        quiet: true,
      });
      this.host.emitMessage(EventType.CHECK, `Check ${s3Url}`);

      if (await objectExists(s3, destination.bucketName, destination.objectKey)) {
        this.host.emitMessage(EventType.FOUND, `Found ${s3Url}`);
        return true;
      }
    } catch (e: any) {
      this.host.emitMessage(EventType.DEBUG, `${e.message}`);
    }
    return false;
  }

  public async publish(options: PublishOptions = {}): Promise<void> {
    const destination = await replaceAwsPlaceholders(this.asset.destination, this.host.aws);
    const s3Url = `s3://${destination.bucketName}/${destination.objectKey}`;

    const clientOptions = destinationToClientOptions(destination);
    const s3 = await this.host.aws.s3Client(clientOptions);
    this.host.emitMessage(EventType.CHECK, `Check ${s3Url}`);

    const bucketInfo = BucketInformation.for(this.host);

    // A thunk for describing the current account. Used when we need to format an error
    // message, not in the success case.
    const account = async () =>
      (await this.host.aws.discoverTargetAccount(clientOptions)).accountId;

    const allowCrossAccount = options.allowCrossAccount ?? true;
    switch (
      await bucketInfo.bucketOwnership(
        s3,
        destination.bucketName,
        allowCrossAccount ? undefined : await account(),
      )
    ) {
      case BucketOwnership.MINE:
        break;
      case BucketOwnership.DOES_NOT_EXIST:
        throw new Error(
          `No bucket named '${destination.bucketName}'. Is account ${await account()} bootstrapped?`,
        );
      case BucketOwnership.NO_ACCESS:
        throw new Error(
          `Bucket named '${destination.bucketName}' exists, but we dont have access to it.`,
        );
      case BucketOwnership.SOMEONE_ELSES_AND_HAVE_ACCESS:
        if (!allowCrossAccount) {
          throw new Error(
            `❗❗ UNEXPECTED BUCKET OWNER DETECTED ❗❗

              We've detected that the S3 bucket ${destination.bucketName} was
              originally created in account ${await account()} as part of the CloudFormation stack CDKToolkit,
              but now resides in a different AWS account. To prevent cross-account asset bucket access of your
              deployments, CDK will stop now.

              If this situation is intentional and you own the AWS account that the bucket has moved to, remove the
              resource named StagingBucket from the template of CloudFormation stack CDKToolkit and try again.

              If this situation is not intentional, we strongly recommend auditing your account to make sure all
              resources are configured the way you expect them [1]. For questions or concerns, please contact
              AWS Support [2].

              [1] https://repost.aws/knowledge-center/potential-account-compromise

              [2] https://aws.amazon.com/support`,
          );
        }
        break;
    }

    if (!options.force && await objectExists(s3, destination.bucketName, destination.objectKey)) {
      this.host.emitMessage(EventType.FOUND, `Found ${s3Url}`);
      return;
    }

    // Identify the the bucket encryption type to set the header on upload
    // required for SCP rules denying uploads without encryption header
    let paramsEncryption: { [index: string]: any } = {};
    const encryption2 = await bucketInfo.bucketEncryption(s3, destination.bucketName);
    switch (encryption2.type) {
      case 'no_encryption':
        break;
      case 'aes256':
        paramsEncryption = { ServerSideEncryption: 'AES256' };
        break;
      case 'kms':
        // We must include the key ID otherwise S3 will encrypt with the default key
        paramsEncryption = {
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: encryption2.kmsKeyId,
        };
        break;
      case 'does_not_exist':
        this.host.emitMessage(
          EventType.DEBUG,
          `No bucket named '${destination.bucketName}'. Is account ${await account()} bootstrapped?`,
        );
        break;
      case 'access_denied':
        this.host.emitMessage(
          EventType.DEBUG,
          `Could not read encryption settings of bucket '${destination.bucketName}': uploading with default settings ("cdk bootstrap" to version 9 if your organization's policies prevent a successful upload or to get rid of this message).`,
        );
        break;
    }

    if (this.host.aborted) {
      return;
    }
    const publishFile = this.asset.source.executable
      ? await this.externalPackageFile(this.asset.source.executable)
      : await this.packageFile(this.asset.source);

    this.host.emitMessage(EventType.UPLOAD, `Upload ${s3Url}`);

    const params = Object.assign(
      {},
      {
        Bucket: destination.bucketName,
        Key: destination.objectKey,
        Body: createReadStream(publishFile.packagedPath),
        ContentType: publishFile.contentType,
        ChecksumAlgorithm: 'SHA256',
      } satisfies PutObjectCommandInput,
      paramsEncryption,
    );

    await s3.upload(params);
  }

  private async packageFile(source: FileSource): Promise<PackagedFileAsset> {
    if (!source.path) {
      throw new Error(
        `'path' is expected in the File asset source, got: ${JSON.stringify(source)}`,
      );
    }

    const fullPath = path.resolve(this.workDir, source.path);

    if (source.packaging === FileAssetPackaging.ZIP_DIRECTORY) {
      const contentType = 'application/zip';

      await fs.mkdir(this.fileCacheRoot, { recursive: true });
      const packagedPath = path.join(this.fileCacheRoot, `${this.asset.id.assetId}.zip`);

      if (await pathExists(packagedPath)) {
        this.host.emitMessage(EventType.CACHED, `From cache ${packagedPath}`);
        return { packagedPath, contentType };
      }

      this.host.emitMessage(EventType.BUILD, `Zip ${fullPath} -> ${packagedPath}`);
      await zipDirectory(fullPath, packagedPath, (m) => this.host.emitMessage(EventType.DEBUG, m));
      return { packagedPath, contentType };
    } else {
      const contentType = mime.getType(fullPath) ?? 'application/octet-stream';
      return { packagedPath: fullPath, contentType };
    }
  }

  private async externalPackageFile(executable: string[]): Promise<PackagedFileAsset> {
    this.host.emitMessage(EventType.BUILD, `Building asset source using command: '${executable}'`);

    const shellEventPublisher = shellEventPublisherFromEventEmitter(this.host.emitMessage);

    return {
      packagedPath: (
        await shell(executable, { subprocessOutputDestination: 'ignore', shellEventPublisher })
      ).trim(),
      contentType: 'application/zip',
    };
  }
}

enum BucketOwnership {
  DOES_NOT_EXIST,
  MINE,
  NO_ACCESS,
  SOMEONE_ELSES_AND_HAVE_ACCESS,
}

type BucketEncryption =
  | { readonly type: 'no_encryption' }
  | { readonly type: 'aes256' }
  | { readonly type: 'kms'; readonly kmsKeyId?: string }
  | { readonly type: 'access_denied' }
  | { readonly type: 'does_not_exist' };

async function objectExists(s3: IS3Client, bucket: string, key: string) {
  /*
   * The object existence check here refrains from using the `headObject` operation because this
   * would create a negative cache entry, making GET-after-PUT eventually consistent. This has been
   * observed to result in CloudFormation issuing "ValidationError: S3 error: Access Denied", for
   * example in https://github.com/aws/aws-cdk/issues/6430.
   *
   * To prevent this, we are instead using the listObjectsV2 call, using the looked up key as the
   * prefix, and limiting results to 1. Since the list operation returns keys ordered by binary
   * UTF-8 representation, the key we are looking for is guaranteed to always be the first match
   * returned if it exists.
   *
   * If the file is too small, we discount it as a cache hit. There is an issue
   * somewhere that sometimes produces empty zip files, and we would otherwise
   * never retry building those assets without users having to manually clear
   * their bucket, which is a bad experience.
   */
  const response = await s3.listObjectsV2({
    Bucket: bucket,
    Prefix: key,
    MaxKeys: 1,
  });
  return (
    response.Contents != null &&
    response.Contents.some(
      (object) => object.Key === key && (object.Size == null || object.Size > EMPTY_ZIP_FILE_SIZE),
    )
  );
}

/**
 * A packaged asset which can be uploaded (either a single file or directory)
 */
interface PackagedFileAsset {
  /**
   * Path of the file or directory
   */
  readonly packagedPath: string;

  /**
   * Content type to be added in the S3 upload action
   *
   * @default - No content type
   */
  readonly contentType?: string;
}

/**
 * Cache for bucket information, so we don't have to keep doing the same calls again and again
 *
 * We scope the lifetime of the cache to the lifetime of the host, so that we don't have to do
 * anything special for tests and yet the cache will live for the entire lifetime of the asset
 * upload session when used by the CLI.
 */
class BucketInformation {
  public static for(host: IHandlerHost) {
    const existing = BucketInformation.caches.get(host);
    if (existing) {
      return existing;
    }

    const fresh = new BucketInformation();
    BucketInformation.caches.set(host, fresh);
    return fresh;
  }

  private static readonly caches = new WeakMap<IHandlerHost, BucketInformation>();

  private readonly ownerships = new Map<string, BucketOwnership>();
  private readonly encryptions = new Map<string, BucketEncryption>();

  private constructor() {
  }

  public async bucketOwnership(
    s3: IS3Client,
    bucket: string,
    expectedAccount?: string,
  ): Promise<BucketOwnership> {
    return cached(this.ownerships, bucket, async () => {
      const anyAccount = await this._bucketOwnership(s3, bucket);

      switch (anyAccount) {
        case BucketOwnership.MINE:
          if (
            expectedAccount &&
            (await this._bucketOwnership(s3, bucket, expectedAccount)) === BucketOwnership.NO_ACCESS
          ) {
            // if the only difference between MINE and NO_ACCESS is the expected account,
            // then its definitely someone else's bucket.
            return BucketOwnership.SOMEONE_ELSES_AND_HAVE_ACCESS;
          }
          return BucketOwnership.MINE;
        default:
          return anyAccount;
      }
    });
  }

  public async bucketEncryption(s3: IS3Client, bucket: string): Promise<BucketEncryption> {
    return cached(this.encryptions, bucket, () => this._bucketEncryption(s3, bucket));
  }

  private async _bucketOwnership(
    s3: IS3Client,
    bucket: string,
    account?: string,
  ): Promise<BucketOwnership.MINE | BucketOwnership.DOES_NOT_EXIST | BucketOwnership.NO_ACCESS> {
    try {
      await s3.getBucketLocation({ Bucket: bucket, ExpectedBucketOwner: account });
      return BucketOwnership.MINE;
    } catch (e: any) {
      if (e.name === 'NoSuchBucket') {
        return BucketOwnership.DOES_NOT_EXIST;
      }
      if (['AccessDenied', 'AllAccessDisabled'].includes(e.name)) {
        return BucketOwnership.NO_ACCESS;
      }
      throw e;
    }
  }

  private async _bucketEncryption(s3: IS3Client, bucket: string): Promise<BucketEncryption> {
    try {
      const encryption = await s3.getBucketEncryption({ Bucket: bucket });
      const l = encryption?.ServerSideEncryptionConfiguration?.Rules?.length ?? 0;
      if (l > 0) {
        const apply =
          encryption?.ServerSideEncryptionConfiguration?.Rules?.at(
            0,
          )?.ApplyServerSideEncryptionByDefault;
        let ssealgo = apply?.SSEAlgorithm;
        if (ssealgo === 'AES256') return { type: 'aes256' };
        if (ssealgo === 'aws:kms') return { type: 'kms', kmsKeyId: apply?.KMSMasterKeyID };
      }
      return { type: 'no_encryption' };
    } catch (e: any) {
      if (e.name === 'NoSuchBucket') {
        return { type: 'does_not_exist' };
      }
      if (e.name === 'ServerSideEncryptionConfigurationNotFoundError') {
        return { type: 'no_encryption' };
      }

      if (['AccessDenied', 'AllAccessDisabled'].includes(e.name)) {
        return { type: 'access_denied' };
      }
      return { type: 'no_encryption' };
    }
  }
}

async function cached<A, B>(cache: Map<A, B>, key: A, factory: (x: A) => Promise<B>): Promise<B> {
  if (cache.has(key)) {
    return cache.get(key)!;
  }

  const fresh = await factory(key);
  cache.set(key, fresh);
  return fresh;
}
