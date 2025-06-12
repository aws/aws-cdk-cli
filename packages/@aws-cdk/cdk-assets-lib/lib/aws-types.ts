/**
 * This file contains a copy of the input and output types from the SDK v3
 * clients. Instead of exposing the SDK types in the public interface, we
 * expose these, shielding consumers from breaking changes in a possible
 * migration to an SDK v4.
 */

import type { Readable } from 'stream';

export interface ResponseMetadata {
  /**
   * The status code of the last HTTP response received for this operation.
   */
  httpStatusCode?: number;
  /**
   * A unique identifier for the last request sent for this operation. Often
   * requested by AWS service teams to aid in debugging.
   */
  requestId?: string;
  /**
   * A secondary identifier for the last request sent. Used for debugging.
   */
  extendedRequestId?: string;
  /**
   * A tertiary identifier for the last request sent. Used for debugging.
   */
  cfId?: string;
  /**
   * The number of times this operation was attempted.
   */
  attempts?: number;
  /**
   * The total amount of time (in milliseconds) that was spent waiting between
   * retry attempts.
   */
  totalRetryDelay?: number;
}

export interface MetadataBearer {
  /**
   * Metadata pertaining to this request.
   */
  $metadata: ResponseMetadata;
}

export interface GetBucketEncryptionCommandInput {
  /**
   * <p>The name of the bucket from which the server-side encryption configuration is
   *          retrieved.</p>
   * <p>Note: To supply the Multi-region Access Point (MRAP) to Bucket, you need to install the "@aws-sdk/signature-v4-crt" package to your project dependencies.
   * For more information, please go to https://github.com/aws/aws-sdk-js-v3#known-issues</p>
   */
  Bucket: string | undefined;
  /**
   * <p>The account ID of the expected bucket owner. If the account ID that you provide does not match the actual owner of the bucket, the request fails with the HTTP status code <code>403 Forbidden</code> (access denied).</p>
   */
  ExpectedBucketOwner?: string;
}

export const ServerSideEncryption = {
  AES256: 'AES256',
  aws_kms: 'aws:kms',
  aws_kms_dsse: 'aws:kms:dsse',
} as const;

export type ServerSideEncryption = (typeof ServerSideEncryption)[keyof typeof ServerSideEncryption];

export interface ServerSideEncryptionByDefault {
  /**
   * <p>Server-side encryption algorithm to use for the default encryption.</p>
   */
  SSEAlgorithm: ServerSideEncryption | undefined;
  /**
   * <p>Amazon Web Services Key Management Service (KMS) customer Amazon Web Services KMS key ID to use for the default
   *          encryption. This parameter is allowed if and only if <code>SSEAlgorithm</code> is set to
   *          <code>aws:kms</code> or <code>aws:kms:dsse</code>.</p>
   *          <p>You can specify the key ID, key alias, or the Amazon Resource Name (ARN) of the KMS
   *          key.</p>
   *          <ul>
   *             <li>
   *                <p>Key ID: <code>1234abcd-12ab-34cd-56ef-1234567890ab</code>
   *                </p>
   *             </li>
   *             <li>
   *                <p>Key ARN: <code>arn:aws:kms:us-east-2:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab</code>
   *                </p>
   *             </li>
   *             <li>
   *                <p>Key Alias: <code>alias/alias-name</code>
   *                </p>
   *             </li>
   *          </ul>
   *          <p>If you use a key ID, you can run into a LogDestination undeliverable error when creating
   *          a VPC flow log. </p>
   *          <p>If you are using encryption with cross-account or Amazon Web Services service operations you must use
   *          a fully qualified KMS key ARN. For more information, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/bucket-encryption.html#bucket-encryption-update-bucket-policy">Using encryption for cross-account operations</a>.</p>
   *          <important>
   *             <p>Amazon S3 only supports symmetric encryption KMS keys. For more information, see <a href="https://docs.aws.amazon.com/kms/latest/developerguide/symmetric-asymmetric.html">Asymmetric keys in Amazon Web Services KMS</a> in the <i>Amazon Web Services Key Management Service
   *                Developer Guide</i>.</p>
   *          </important>
   */
  KMSMasterKeyID?: string;
}

export interface ServerSideEncryptionRule {
  /**
   * <p>Specifies the default server-side encryption to apply to new objects in the bucket. If a
   *          PUT Object request doesn't specify any server-side encryption, this default encryption will
   *          be applied.</p>
   */
  ApplyServerSideEncryptionByDefault?: ServerSideEncryptionByDefault;
  /**
   * <p>Specifies whether Amazon S3 should use an S3 Bucket Key with server-side encryption using KMS
   *          (SSE-KMS) for new objects in the bucket. Existing objects are not affected. Setting the
   *             <code>BucketKeyEnabled</code> element to <code>true</code> causes Amazon S3 to use an S3
   *          Bucket Key. By default, S3 Bucket Key is not enabled.</p>
   *          <p>For more information, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/bucket-key.html">Amazon S3 Bucket Keys</a> in the
   *             <i>Amazon S3 User Guide</i>.</p>
   */
  BucketKeyEnabled?: boolean;
}

export interface ServerSideEncryptionConfiguration {
  /**
   * <p>Container for information about a particular server-side encryption configuration
   *          rule.</p>
   */
  Rules: ServerSideEncryptionRule[] | undefined;
}

export interface GetBucketEncryptionOutput {
  /**
   * <p>Specifies the default server-side-encryption configuration.</p>
   */
  ServerSideEncryptionConfiguration?: ServerSideEncryptionConfiguration;
}

export interface GetBucketEncryptionCommandOutput
  extends GetBucketEncryptionOutput,
  MetadataBearer {
}

export interface GetBucketLocationCommandInput {
  /**
   * <p>The name of the bucket for which to get the location.</p>
   *          <p>When you use this API operation with an access point, provide the alias of the access point in place of the bucket name.</p>
   *          <p>When you use this API operation with an Object Lambda access point, provide the alias of the Object Lambda access point in place of the bucket name.
   * If the Object Lambda access point alias in a request is not valid, the error code <code>InvalidAccessPointAliasError</code> is returned.
   * For more information about <code>InvalidAccessPointAliasError</code>, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html#ErrorCodeList">List of
   *             Error Codes</a>.</p>
   * <p>Note: To supply the Multi-region Access Point (MRAP) to Bucket, you need to install the "@aws-sdk/signature-v4-crt" package to your project dependencies.
   * For more information, please go to https://github.com/aws/aws-sdk-js-v3#known-issues</p>
   */
  Bucket: string | undefined;
  /**
   * <p>The account ID of the expected bucket owner. If the account ID that you provide does not match the actual owner of the bucket, the request fails with the HTTP status code <code>403 Forbidden</code> (access denied).</p>
   */
  ExpectedBucketOwner?: string;
}

export const BucketLocationConstraint = {
  EU: 'EU',
  af_south_1: 'af-south-1',
  ap_east_1: 'ap-east-1',
  ap_northeast_1: 'ap-northeast-1',
  ap_northeast_2: 'ap-northeast-2',
  ap_northeast_3: 'ap-northeast-3',
  ap_south_1: 'ap-south-1',
  ap_south_2: 'ap-south-2',
  ap_southeast_1: 'ap-southeast-1',
  ap_southeast_2: 'ap-southeast-2',
  ap_southeast_3: 'ap-southeast-3',
  ap_southeast_4: 'ap-southeast-4',
  ap_southeast_5: 'ap-southeast-5',
  ca_central_1: 'ca-central-1',
  cn_north_1: 'cn-north-1',
  cn_northwest_1: 'cn-northwest-1',
  eu_central_1: 'eu-central-1',
  eu_central_2: 'eu-central-2',
  eu_north_1: 'eu-north-1',
  eu_south_1: 'eu-south-1',
  eu_south_2: 'eu-south-2',
  eu_west_1: 'eu-west-1',
  eu_west_2: 'eu-west-2',
  eu_west_3: 'eu-west-3',
  il_central_1: 'il-central-1',
  me_south_1: 'me-south-1',
  me_central_1: 'me-central-1',
  sa_east_1: 'sa-east-1',
  us_east_2: 'us-east-2',
  us_gov_east_1: 'us-gov-east-1',
  us_gov_west_1: 'us-gov-west-1',
  us_west_1: 'us-west-1',
  us_west_2: 'us-west-2',
} as const;

export type BucketLocationConstraint =
  (typeof BucketLocationConstraint)[keyof typeof BucketLocationConstraint];

export interface GetBucketLocationOutput {
  /**
   * <p>Specifies the Region where the bucket resides. For a list of all the Amazon S3 supported
   *          location constraints by Region, see <a href="https://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region">Regions and Endpoints</a>. Buckets in
   *          Region <code>us-east-1</code> have a LocationConstraint of <code>null</code>.</p>
   */
  LocationConstraint?: BucketLocationConstraint;
}

export interface GetBucketLocationCommandOutput extends GetBucketLocationOutput, MetadataBearer {
}

export const EncodingType = {
  url: 'url',
} as const;

export type EncodingType = (typeof EncodingType)[keyof typeof EncodingType];

export const RequestPayer = {
  requester: 'requester',
} as const;

export type RequestPayer = (typeof RequestPayer)[keyof typeof RequestPayer];

export const OptionalObjectAttributes = {
  RESTORE_STATUS: 'RestoreStatus',
} as const;

export type OptionalObjectAttributes =
  (typeof OptionalObjectAttributes)[keyof typeof OptionalObjectAttributes];

export interface ListObjectsV2CommandInput {
  /**
   * <p>
   *             <b>Directory buckets</b> - When you use this operation with a directory bucket, you must use virtual-hosted-style requests in the format <code>
   *                <i>Bucket_name</i>.s3express-<i>az_id</i>.<i>region</i>.amazonaws.com</code>. Path-style requests are not supported.  Directory bucket names must be unique in the chosen Availability Zone. Bucket names must follow the format <code>
   *                <i>bucket_base_name</i>--<i>az-id</i>--x-s3</code> (for example, <code>
   *                <i>DOC-EXAMPLE-BUCKET</i>--<i>usw2-az1</i>--x-s3</code>). For information about bucket naming
   *          restrictions, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/directory-bucket-naming-rules.html">Directory bucket naming
   *             rules</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <p>
   *             <b>Access points</b> - When you use this action with an access point, you must provide the alias of the access point in place of the bucket name or specify the access point ARN. When using the access point ARN, you must direct requests to the access point hostname. The access point hostname takes the form <i>AccessPointName</i>-<i>AccountId</i>.s3-accesspoint.<i>Region</i>.amazonaws.com. When using this action with an access point through the Amazon Web Services SDKs, you provide the access point ARN in place of the bucket name. For more information about access point ARNs, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-access-points.html">Using access points</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <note>
   *             <p>Access points and Object Lambda access points are not supported by directory buckets.</p>
   *          </note>
   *          <p>
   *             <b>S3 on Outposts</b> - When you use this action with Amazon S3 on Outposts, you must direct requests to the S3 on Outposts hostname. The S3 on Outposts hostname takes the form <code>
   *                <i>AccessPointName</i>-<i>AccountId</i>.<i>outpostID</i>.s3-outposts.<i>Region</i>.amazonaws.com</code>. When you use this action with S3 on Outposts through the Amazon Web Services SDKs, you provide the Outposts access point ARN in place of the bucket name. For more information about S3 on Outposts ARNs, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/S3onOutposts.html">What is S3 on Outposts?</a> in the <i>Amazon S3 User Guide</i>.</p>
   * <p>Note: To supply the Multi-region Access Point (MRAP) to Bucket, you need to install the "@aws-sdk/signature-v4-crt" package to your project dependencies.
   * For more information, please go to https://github.com/aws/aws-sdk-js-v3#known-issues</p>
   */
  Bucket: string | undefined;
  /**
   * <p>A delimiter is a character that you use to group keys.</p>
   *          <note>
   *             <ul>
   *                <li>
   *                   <p>
   *                      <b>Directory buckets</b> - For directory buckets, <code>/</code> is the only supported delimiter.</p>
   *                </li>
   *                <li>
   *                   <p>
   *                      <b>Directory buckets </b> - When you query <code>ListObjectsV2</code> with a delimiter during in-progress multipart uploads, the
   *             <code>CommonPrefixes</code> response parameter contains the prefixes that are associated with the in-progress multipart uploads.
   *                For more information about multipart uploads, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/mpuoverview.html">Multipart Upload Overview</a> in the <i>Amazon S3 User Guide</i>.</p>
   *                </li>
   *             </ul>
   *          </note>
   */
  Delimiter?: string;
  /**
   * <p>Encoding type used by Amazon S3 to encode the <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html">object keys</a> in the response.
   *          Responses are encoded only in UTF-8. An object key can contain any Unicode character.
   *          However, the XML 1.0 parser can't parse certain characters, such as characters with an
   *          ASCII value from 0 to 10. For characters that aren't supported in XML 1.0, you can add this
   *          parameter to request that Amazon S3 encode the keys in the response. For more information about
   *          characters to avoid in object key names, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html#object-key-guidelines">Object key naming
   *             guidelines</a>.</p>
   *          <note>
   *             <p>When using the URL encoding type, non-ASCII characters that are used in an object's
   *             key name will be percent-encoded according to UTF-8 code values. For example, the object
   *             <code>test_file(3).png</code> will appear as
   *             <code>test_file%283%29.png</code>.</p>
   *          </note>
   */
  EncodingType?: EncodingType;
  /**
   * <p>Sets the maximum number of keys returned in the response. By default, the action returns
   *          up to 1,000 key names. The response might contain fewer keys but will never contain
   *          more.</p>
   */
  MaxKeys?: number;
  /**
   * <p>Limits the response to keys that begin with the specified prefix.</p>
   *          <note>
   *             <p>
   *                <b>Directory buckets</b> - For directory buckets, only prefixes that end in a delimiter (<code>/</code>) are supported.</p>
   *          </note>
   */
  Prefix?: string;
  /**
   * <p>
   *             <code>ContinuationToken</code> indicates to Amazon S3 that the list is being continued on
   *          this bucket with a token. <code>ContinuationToken</code> is obfuscated and is not a real
   *          key. You can use this <code>ContinuationToken</code> for pagination of the list results.  </p>
   */
  ContinuationToken?: string;
  /**
   * <p>The owner field is not present in <code>ListObjectsV2</code> by default. If you want to
   *          return the owner field with each key in the result, then set the <code>FetchOwner</code>
   *          field to <code>true</code>.</p>
   *          <note>
   *             <p>
   *                <b>Directory buckets</b> - For directory buckets, the bucket owner is returned as the object owner for all objects.</p>
   *          </note>
   */
  FetchOwner?: boolean;
  /**
   * <p>StartAfter is where you want Amazon S3 to start listing from. Amazon S3 starts listing after this
   *          specified key. StartAfter can be any key in the bucket.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  StartAfter?: string;
  /**
   * <p>Confirms that the requester knows that she or he will be charged for the list objects
   *          request in V2 style. Bucket owners need not specify this parameter in their
   *          requests.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  RequestPayer?: RequestPayer;
  /**
   * <p>The account ID of the expected bucket owner. If the account ID that you provide does not match the actual owner of the bucket, the request fails with the HTTP status code <code>403 Forbidden</code> (access denied).</p>
   */
  ExpectedBucketOwner?: string;
  /**
   * <p>Specifies the optional fields that you want returned in the response. Fields that you do
   *          not specify are not returned.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  OptionalObjectAttributes?: OptionalObjectAttributes[];
}

export const RequestCharged = {
  requester: 'requester',
} as const;

export type RequestCharged = (typeof RequestCharged)[keyof typeof RequestCharged];

export const ChecksumAlgorithmIn = {
  CRC32: 'CRC32',
  CRC32C: 'CRC32C',
  SHA1: 'SHA1',
  SHA256: 'SHA256',
} as const;

export type ChecksumAlgorithmIn = (typeof ChecksumAlgorithmIn)[keyof typeof ChecksumAlgorithmIn];

export type ChecksumAlgorithmOut = string;

export const ObjectStorageClass = {
  DEEP_ARCHIVE: 'DEEP_ARCHIVE',
  EXPRESS_ONEZONE: 'EXPRESS_ONEZONE',
  GLACIER: 'GLACIER',
  GLACIER_IR: 'GLACIER_IR',
  INTELLIGENT_TIERING: 'INTELLIGENT_TIERING',
  ONEZONE_IA: 'ONEZONE_IA',
  OUTPOSTS: 'OUTPOSTS',
  REDUCED_REDUNDANCY: 'REDUCED_REDUNDANCY',
  SNOW: 'SNOW',
  STANDARD: 'STANDARD',
  STANDARD_IA: 'STANDARD_IA',
} as const;

export type ObjectStorageClass = (typeof ObjectStorageClass)[keyof typeof ObjectStorageClass];

export interface Owner {
  /**
   * <p>Container for the display name of the owner. This value is only supported in the
   *          following Amazon Web Services Regions:</p>
   *          <ul>
   *             <li>
   *                <p>US East (N. Virginia)</p>
   *             </li>
   *             <li>
   *                <p>US West (N. California)</p>
   *             </li>
   *             <li>
   *                <p>US West (Oregon)</p>
   *             </li>
   *             <li>
   *                <p>Asia Pacific (Singapore)</p>
   *             </li>
   *             <li>
   *                <p>Asia Pacific (Sydney)</p>
   *             </li>
   *             <li>
   *                <p>Asia Pacific (Tokyo)</p>
   *             </li>
   *             <li>
   *                <p>Europe (Ireland)</p>
   *             </li>
   *             <li>
   *                <p>South America (São Paulo)</p>
   *             </li>
   *          </ul>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  DisplayName?: string;

  /**
   * <p>Container for the ID of the owner.</p>
   */
  ID?: string;
}

export interface RestoreStatus {
  /**
   * <p>Specifies whether the object is currently being restored. If the object restoration is
   *          in progress, the header returns the value <code>TRUE</code>. For example:</p>
   *          <p>
   *             <code>x-amz-optional-object-attributes: IsRestoreInProgress="true"</code>
   *          </p>
   *          <p>If the object restoration has completed, the header returns the value
   *          <code>FALSE</code>. For example:</p>
   *          <p>
   *             <code>x-amz-optional-object-attributes: IsRestoreInProgress="false",
   *             RestoreExpiryDate="2012-12-21T00:00:00.000Z"</code>
   *          </p>
   *          <p>If the object hasn't been restored, there is no header response.</p>
   */
  IsRestoreInProgress?: boolean;

  /**
   * <p>Indicates when the restored copy will expire. This value is populated only if the object
   *          has already been restored. For example:</p>
   *          <p>
   *             <code>x-amz-optional-object-attributes: IsRestoreInProgress="false",
   *             RestoreExpiryDate="2012-12-21T00:00:00.000Z"</code>
   *          </p>
   */
  RestoreExpiryDate?: Date;
}

/**
 * Return one of 2 types, depending on whether we are passing values in or out
 *
 * Use as follows:
 *
 * ```ts
 * interface ContainingType<Dir> {
 *    field: InOut<Dir, FieldTypeIn, FieldTypeOut>;
 * }
 * ```
 */
type InOut<Dir, I, O> = Dir extends 'in' ? I : Dir extends 'out' ? O : never;

export interface _Object<Dir> {
  /**
   * <p>The name that you assign to an object. You use the object key to retrieve the
   *          object.</p>
   */
  Key?: string;

  /**
   * <p>Creation date of the object.</p>
   */
  LastModified?: Date;

  /**
   * <p>The entity tag is a hash of the object. The ETag reflects changes only to the contents
   *          of an object, not its metadata. The ETag may or may not be an MD5 digest of the object
   *          data. Whether or not it is depends on how the object was created and how it is encrypted as
   *          described below:</p>
   *          <ul>
   *             <li>
   *                <p>Objects created by the PUT Object, POST Object, or Copy operation, or through the
   *                Amazon Web Services Management Console, and are encrypted by SSE-S3 or plaintext, have ETags that
   *                are an MD5 digest of their object data.</p>
   *             </li>
   *             <li>
   *                <p>Objects created by the PUT Object, POST Object, or Copy operation, or through the
   *                Amazon Web Services Management Console, and are encrypted by SSE-C or SSE-KMS, have ETags that are
   *                not an MD5 digest of their object data.</p>
   *             </li>
   *             <li>
   *                <p>If an object is created by either the Multipart Upload or Part Copy operation, the
   *                ETag is not an MD5 digest, regardless of the method of encryption. If an object is
   *                larger than 16 MB, the Amazon Web Services Management Console will upload or copy that object as a
   *                Multipart Upload, and therefore the ETag will not be an MD5 digest.</p>
   *             </li>
   *          </ul>
   *          <note>
   *             <p>
   *                <b>Directory buckets</b> - MD5 is not supported by directory buckets.</p>
   *          </note>
   */
  ETag?: string;

  /**
   * <p>The algorithm that was used to create a checksum of the object.</p>
   */
  ChecksumAlgorithm?: InOut<Dir, ChecksumAlgorithmIn, ChecksumAlgorithmOut>[];

  /**
   * <p>Size in bytes of the object</p>
   */
  Size?: number;

  /**
   * <p>The class of storage used to store the object.</p>
   *          <note>
   *             <p>
   *                <b>Directory buckets</b> - Only the S3 Express One Zone storage class is supported by directory buckets to store objects.</p>
   *          </note>
   */
  StorageClass?: ObjectStorageClass;

  /**
   * <p>The owner of the object</p>
   *          <note>
   *             <p>
   *                <b>Directory buckets</b> - The bucket owner is returned as the object owner.</p>
   *          </note>
   */
  Owner?: Owner;

  /**
   * <p>Specifies the restoration status of an object. Objects in certain storage classes must
   *          be restored before they can be retrieved. For more information about these storage classes
   *          and how to work with archived objects, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/archived-objects.html"> Working with archived
   *             objects</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets. Only the S3 Express One Zone storage class is supported by directory buckets to store objects.</p>
   *          </note>
   */
  RestoreStatus?: RestoreStatus;
}

export interface CommonPrefix {
  /**
   * <p>Container for the specified common prefix.</p>
   */
  Prefix?: string;
}

export interface ListObjectsV2Output {
  /**
   * <p>Set to <code>false</code> if all of the results were returned. Set to <code>true</code>
   *          if more keys are available to return. If the number of results exceeds that specified by
   *             <code>MaxKeys</code>, all of the results might not be returned.</p>
   */
  IsTruncated?: boolean;
  /**
   * <p>Metadata about each object returned.</p>
   */
  Contents?: _Object<'out'>[];
  /**
   * <p>The bucket name.</p>
   */
  Name?: string;
  /**
   * <p>Keys that begin with the indicated prefix.</p>
   *          <note>
   *             <p>
   *                <b>Directory buckets</b> - For directory buckets, only prefixes that end in a delimiter (<code>/</code>) are supported.</p>
   *          </note>
   */
  Prefix?: string;
  /**
   * <p>Causes keys that contain the same string between the <code>prefix</code> and the first
   *          occurrence of the delimiter to be rolled up into a single result element in the
   *             <code>CommonPrefixes</code> collection. These rolled-up keys are not returned elsewhere
   *          in the response. Each rolled-up result counts as only one return against the
   *             <code>MaxKeys</code> value.</p>
   *          <note>
   *             <p>
   *                <b>Directory buckets</b> - For directory buckets, <code>/</code> is the only supported delimiter.</p>
   *          </note>
   */
  Delimiter?: string;
  /**
   * <p>Sets the maximum number of keys returned in the response. By default, the action returns
   *          up to 1,000 key names. The response might contain fewer keys but will never contain
   *          more.</p>
   */
  MaxKeys?: number;
  /**
   * <p>All of the keys (up to 1,000) that share the same prefix are grouped together. When counting the total numbers of returns by this API operation,
   *          this group of keys is considered as one item.</p>
   *          <p>A response can contain <code>CommonPrefixes</code> only if you specify a
   *          delimiter.</p>
   *          <p>
   *             <code>CommonPrefixes</code> contains all (if there are any) keys between
   *             <code>Prefix</code> and the next occurrence of the string specified by a
   *          delimiter.</p>
   *          <p>
   *             <code>CommonPrefixes</code> lists keys that act like subdirectories in the directory
   *          specified by <code>Prefix</code>.</p>
   *          <p>For example, if the prefix is <code>notes/</code> and the delimiter is a slash
   *             (<code>/</code>) as in <code>notes/summer/july</code>, the common prefix is
   *             <code>notes/summer/</code>. All of the keys that roll up into a common prefix count as a
   *          single return when calculating the number of returns. </p>
   *          <note>
   *             <ul>
   *                <li>
   *                   <p>
   *                      <b>Directory buckets</b> - For directory buckets, only prefixes that end in a delimiter (<code>/</code>) are supported.</p>
   *                </li>
   *                <li>
   *                   <p>
   *                      <b>Directory buckets </b> - When you query <code>ListObjectsV2</code> with a delimiter during in-progress multipart uploads, the
   *                <code>CommonPrefixes</code> response parameter contains the prefixes that are associated with the in-progress multipart uploads.
   *                For more information about multipart uploads, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/mpuoverview.html">Multipart Upload Overview</a> in the <i>Amazon S3 User Guide</i>.</p>
   *                </li>
   *             </ul>
   *          </note>
   */
  CommonPrefixes?: CommonPrefix[];
  /**
   * <p>Encoding type used by Amazon S3 to encode object key names in the XML response.</p>
   *          <p>If you specify the <code>encoding-type</code> request parameter, Amazon S3 includes this
   *          element in the response, and returns encoded key name values in the following response
   *          elements:</p>
   *          <p>
   *             <code>Delimiter, Prefix, Key,</code> and <code>StartAfter</code>.</p>
   */
  EncodingType?: EncodingType;
  /**
   * <p>
   *             <code>KeyCount</code> is the number of keys returned with this request.
   *             <code>KeyCount</code> will always be less than or equal to the <code>MaxKeys</code>
   *          field. For example, if you ask for 50 keys, your result will include 50 keys or
   *          fewer.</p>
   */
  KeyCount?: number;
  /**
   * <p> If <code>ContinuationToken</code> was sent with the request, it is included in the
   *          response. You can use the returned <code>ContinuationToken</code> for pagination of the list response. You can use this <code>ContinuationToken</code> for pagination of the list results. </p>
   */
  ContinuationToken?: string;
  /**
   * <p>
   *             <code>NextContinuationToken</code> is sent when <code>isTruncated</code> is true, which
   *          means there are more keys in the bucket that can be listed. The next list requests to Amazon S3
   *          can be continued with this <code>NextContinuationToken</code>.
   *             <code>NextContinuationToken</code> is obfuscated and is not a real key</p>
   */
  NextContinuationToken?: string;
  /**
   * <p>If StartAfter was sent with the request, it is included in the response.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  StartAfter?: string;
  /**
   * <p>If present, indicates that the requester was successfully charged for the
   *          request.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  RequestCharged?: RequestCharged;
}

export interface ListObjectsV2CommandOutput extends ListObjectsV2Output, MetadataBearer {
}

export const ObjectCannedACL = {
  authenticated_read: 'authenticated-read',
  aws_exec_read: 'aws-exec-read',
  bucket_owner_full_control: 'bucket-owner-full-control',
  bucket_owner_read: 'bucket-owner-read',
  private: 'private',
  public_read: 'public-read',
  public_read_write: 'public-read-write',
} as const;

export type ObjectCannedACL = (typeof ObjectCannedACL)[keyof typeof ObjectCannedACL];

export const ObjectLockMode = {
  COMPLIANCE: 'COMPLIANCE',
  GOVERNANCE: 'GOVERNANCE',
} as const;

export type ObjectLockMode = (typeof ObjectLockMode)[keyof typeof ObjectLockMode];

export const ObjectLockLegalHoldStatus = {
  OFF: 'OFF',
  ON: 'ON',
} as const;

export type ObjectLockLegalHoldStatus =
  (typeof ObjectLockLegalHoldStatus)[keyof typeof ObjectLockLegalHoldStatus];

export const StorageClass = {
  DEEP_ARCHIVE: 'DEEP_ARCHIVE',
  EXPRESS_ONEZONE: 'EXPRESS_ONEZONE',
  GLACIER: 'GLACIER',
  GLACIER_IR: 'GLACIER_IR',
  INTELLIGENT_TIERING: 'INTELLIGENT_TIERING',
  ONEZONE_IA: 'ONEZONE_IA',
  OUTPOSTS: 'OUTPOSTS',
  REDUCED_REDUNDANCY: 'REDUCED_REDUNDANCY',
  SNOW: 'SNOW',
  STANDARD: 'STANDARD',
  STANDARD_IA: 'STANDARD_IA',
} as const;

export type StorageClass = (typeof StorageClass)[keyof typeof StorageClass];

export interface Identity {
  /**
   * A `Date` when the identity or credential will no longer be accepted.
   */
  readonly expiration?: Date;
}

export interface IdentityProvider<IdentityT extends Identity> {
  (identityProperties?: Record<string, any>): Promise<IdentityT>;
}

export interface AwsCredentialIdentity extends Identity {
  /**
   * AWS access key ID
   */
  readonly accessKeyId: string;
  /**
   * AWS secret access key
   */
  readonly secretAccessKey: string;
  /**
   * A security or session token to use with these credentials. Usually
   * present for temporary credentials.
   */
  readonly sessionToken?: string;
  /**
   * AWS credential scope for this set of credentials.
   */
  readonly credentialScope?: string;
  /**
   * AWS accountId.
   */
  readonly accountId?: string;
}

export type AwsCredentialIdentityProvider = IdentityProvider<AwsCredentialIdentity>;

export interface PutObjectRequest {
  /**
   * <p>The canned ACL to apply to the object. For more information, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html#CannedACL">Canned
   *          ACL</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <p>When adding a new object, you can use headers to grant ACL-based permissions to
   *          individual Amazon Web Services accounts or to predefined groups defined by Amazon S3. These permissions are
   *          then added to the ACL on the object. By default, all objects are private. Only the owner
   *          has full access control. For more information, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html">Access Control List (ACL) Overview</a>
   *          and <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-using-rest-api.html">Managing
   *             ACLs Using the REST API</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <p>If the bucket that you're uploading objects to uses the bucket owner enforced setting
   *          for S3 Object Ownership, ACLs are disabled and no longer affect permissions. Buckets that
   *          use this setting only accept PUT requests that don't specify an ACL or PUT requests that
   *          specify bucket owner full control ACLs, such as the <code>bucket-owner-full-control</code>
   *          canned ACL or an equivalent form of this ACL expressed in the XML format. PUT requests that
   *          contain other ACLs (for example, custom grants to certain Amazon Web Services accounts) fail and return a
   *          <code>400</code> error with the error code <code>AccessControlListNotSupported</code>.
   *          For more information, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html"> Controlling ownership of
   *             objects and disabling ACLs</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <note>
   *             <ul>
   *                <li>
   *                   <p>This functionality is not supported for directory buckets.</p>
   *                </li>
   *                <li>
   *                   <p>This functionality is not supported for Amazon S3 on Outposts.</p>
   *                </li>
   *             </ul>
   *          </note>
   */
  ACL?: ObjectCannedACL;
  /**
   * <p>Object data.</p>
   */
  Body?: Readable;
  /**
   * <p>The bucket name to which the PUT action was initiated. </p>
   *          <p>
   *             <b>Directory buckets</b> - When you use this operation with a directory bucket, you must use virtual-hosted-style requests in the format <code>
   *                <i>Bucket_name</i>.s3express-<i>az_id</i>.<i>region</i>.amazonaws.com</code>. Path-style requests are not supported.  Directory bucket names must be unique in the chosen Availability Zone. Bucket names must follow the format <code>
   *                <i>bucket_base_name</i>--<i>az-id</i>--x-s3</code> (for example, <code>
   *                <i>DOC-EXAMPLE-BUCKET</i>--<i>usw2-az1</i>--x-s3</code>). For information about bucket naming
   *          restrictions, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/directory-bucket-naming-rules.html">Directory bucket naming
   *             rules</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <p>
   *             <b>Access points</b> - When you use this action with an access point, you must provide the alias of the access point in place of the bucket name or specify the access point ARN. When using the access point ARN, you must direct requests to the access point hostname. The access point hostname takes the form <i>AccessPointName</i>-<i>AccountId</i>.s3-accesspoint.<i>Region</i>.amazonaws.com. When using this action with an access point through the Amazon Web Services SDKs, you provide the access point ARN in place of the bucket name. For more information about access point ARNs, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-access-points.html">Using access points</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <note>
   *             <p>Access points and Object Lambda access points are not supported by directory buckets.</p>
   *          </note>
   *          <p>
   *             <b>S3 on Outposts</b> - When you use this action with Amazon S3 on Outposts, you must direct requests to the S3 on Outposts hostname. The S3 on Outposts hostname takes the form <code>
   *                <i>AccessPointName</i>-<i>AccountId</i>.<i>outpostID</i>.s3-outposts.<i>Region</i>.amazonaws.com</code>. When you use this action with S3 on Outposts through the Amazon Web Services SDKs, you provide the Outposts access point ARN in place of the bucket name. For more information about S3 on Outposts ARNs, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/S3onOutposts.html">What is S3 on Outposts?</a> in the <i>Amazon S3 User Guide</i>.</p>
   * <p>Note: To supply the Multi-region Access Point (MRAP) to Bucket, you need to install the "@aws-sdk/signature-v4-crt" package to your project dependencies.
   * For more information, please go to https://github.com/aws/aws-sdk-js-v3#known-issues</p>
   */
  Bucket: string | undefined;
  /**
   * <p>Can be used to specify caching behavior along the request/reply chain. For more
   *          information, see <a href="http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.9">http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.9</a>.</p>
   */
  CacheControl?: string;
  /**
   * <p>Specifies presentational information for the object. For more information, see <a href="https://www.rfc-editor.org/rfc/rfc6266#section-4">https://www.rfc-editor.org/rfc/rfc6266#section-4</a>.</p>
   */
  ContentDisposition?: string;
  /**
   * <p>Specifies what content encodings have been applied to the object and thus what decoding
   *          mechanisms must be applied to obtain the media-type referenced by the Content-Type header
   *          field. For more information, see <a href="https://www.rfc-editor.org/rfc/rfc9110.html#field.content-encoding">https://www.rfc-editor.org/rfc/rfc9110.html#field.content-encoding</a>.</p>
   */
  ContentEncoding?: string;
  /**
   * <p>The language the content is in.</p>
   */
  ContentLanguage?: string;
  /**
   * <p>Size of the body in bytes. This parameter is useful when the size of the body cannot be
   *          determined automatically. For more information, see <a href="https://www.rfc-editor.org/rfc/rfc9110.html#name-content-length">https://www.rfc-editor.org/rfc/rfc9110.html#name-content-length</a>.</p>
   */
  ContentLength?: number;
  /**
   * <p>The base64-encoded 128-bit MD5 digest of the message (without the headers) according to
   *          RFC 1864. This header can be used as a message integrity check to verify that the data is
   *          the same data that was originally sent. Although it is optional, we recommend using the
   *          Content-MD5 mechanism as an end-to-end integrity check. For more information about REST
   *          request authentication, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/RESTAuthentication.html">REST Authentication</a>.</p>
   *          <note>
   *             <p>The <code>Content-MD5</code> header is required for any request to upload an
   *          object with a retention period configured using Amazon S3 Object Lock. For more
   *          information about Amazon S3 Object Lock, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/object-lock-overview.html">Amazon S3 Object Lock
   *             Overview</a> in the <i>Amazon S3 User Guide</i>. </p>
   *          </note>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  ContentMD5?: string;
  /**
   * <p>A standard MIME type describing the format of the contents. For more information, see
   *             <a href="https://www.rfc-editor.org/rfc/rfc9110.html#name-content-type">https://www.rfc-editor.org/rfc/rfc9110.html#name-content-type</a>.</p>
   */
  ContentType?: string;
  /**
   * <p>Indicates the algorithm used to create the checksum for the object when you use the SDK. This header will not provide any
   *     additional functionality if you don't use the SDK. When you send this header, there must be a corresponding <code>x-amz-checksum-<i>algorithm</i>
   *             </code> or
   *     <code>x-amz-trailer</code> header sent. Otherwise, Amazon S3 fails the request with the HTTP status code <code>400 Bad Request</code>.</p>
   *          <p>For the <code>x-amz-checksum-<i>algorithm</i>
   *             </code> header, replace <code>
   *                <i>algorithm</i>
   *             </code> with the supported algorithm from the following list: </p>
   *          <ul>
   *             <li>
   *                <p>CRC32</p>
   *             </li>
   *             <li>
   *                <p>CRC32C</p>
   *             </li>
   *             <li>
   *                <p>SHA1</p>
   *             </li>
   *             <li>
   *                <p>SHA256</p>
   *             </li>
   *          </ul>
   *          <p>For more
   *     information, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html">Checking object integrity</a> in
   *     the <i>Amazon S3 User Guide</i>.</p>
   *          <p>If the individual checksum value you provide through <code>x-amz-checksum-<i>algorithm</i>
   *             </code> doesn't match the checksum algorithm you set through <code>x-amz-sdk-checksum-algorithm</code>,  Amazon S3 ignores any provided
   *             <code>ChecksumAlgorithm</code> parameter and uses the checksum algorithm that matches the provided value in <code>x-amz-checksum-<i>algorithm</i>
   *             </code>.</p>
   *          <note>
   *             <p>For directory buckets, when you use Amazon Web Services SDKs, <code>CRC32</code> is the default checksum algorithm that's used for performance.</p>
   *          </note>
   */
  ChecksumAlgorithm?: ChecksumAlgorithmIn;
  /**
   * <p>This header can be used as a data integrity check to verify that the data received is the same data that was originally sent.
   *     This header specifies the base64-encoded, 32-bit CRC32 checksum of the object. For more information, see
   *     <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html">Checking object integrity</a> in the
   *     <i>Amazon S3 User Guide</i>.</p>
   */
  ChecksumCRC32?: string;
  /**
   * <p>This header can be used as a data integrity check to verify that the data received is the same data that was originally sent.
   *     This header specifies the base64-encoded, 32-bit CRC32C checksum of the object. For more information, see
   *     <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html">Checking object integrity</a> in the
   *     <i>Amazon S3 User Guide</i>.</p>
   */
  ChecksumCRC32C?: string;
  /**
   * <p>This header can be used as a data integrity check to verify that the data received is the same data that was originally sent.
   *     This header specifies the base64-encoded, 160-bit SHA-1 digest of the object. For more information, see
   *     <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html">Checking object integrity</a> in the
   *     <i>Amazon S3 User Guide</i>.</p>
   */
  ChecksumSHA1?: string;
  /**
   * <p>This header can be used as a data integrity check to verify that the data received is the same data that was originally sent.
   *     This header specifies the base64-encoded, 256-bit SHA-256 digest of the object. For more information, see
   *     <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html">Checking object integrity</a> in the
   *     <i>Amazon S3 User Guide</i>.</p>
   */
  ChecksumSHA256?: string;
  /**
   * <p>The date and time at which the object is no longer cacheable. For more information, see
   *             <a href="https://www.rfc-editor.org/rfc/rfc7234#section-5.3">https://www.rfc-editor.org/rfc/rfc7234#section-5.3</a>.</p>
   */
  Expires?: Date;
  /**
   * <p>Uploads the object only if the object key name does not already exist in the bucket specified. Otherwise, Amazon S3 returns a <code>412 Precondition Failed</code> error.</p>
   *          <p>If a conflicting operation occurs during the upload S3 returns a <code>409 ConditionalRequestConflict</code> response. On a 409 failure you should retry the upload.</p>
   *          <p>Expects the '*' (asterisk) character.</p>
   *          <p>For more information about conditional requests, see <a href="https://tools.ietf.org/html/rfc7232">RFC 7232</a>, or <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-requests.html">Conditional requests</a> in the <i>Amazon S3 User Guide</i>.</p>
   */
  IfNoneMatch?: string;
  /**
   * <p>Gives the grantee READ, READ_ACP, and WRITE_ACP permissions on the object.</p>
   *          <note>
   *             <ul>
   *                <li>
   *                   <p>This functionality is not supported for directory buckets.</p>
   *                </li>
   *                <li>
   *                   <p>This functionality is not supported for Amazon S3 on Outposts.</p>
   *                </li>
   *             </ul>
   *          </note>
   */
  GrantFullControl?: string;
  /**
   * <p>Allows grantee to read the object data and its metadata.</p>
   *          <note>
   *             <ul>
   *                <li>
   *                   <p>This functionality is not supported for directory buckets.</p>
   *                </li>
   *                <li>
   *                   <p>This functionality is not supported for Amazon S3 on Outposts.</p>
   *                </li>
   *             </ul>
   *          </note>
   */
  GrantRead?: string;
  /**
   * <p>Allows grantee to read the object ACL.</p>
   *          <note>
   *             <ul>
   *                <li>
   *                   <p>This functionality is not supported for directory buckets.</p>
   *                </li>
   *                <li>
   *                   <p>This functionality is not supported for Amazon S3 on Outposts.</p>
   *                </li>
   *             </ul>
   *          </note>
   */
  GrantReadACP?: string;
  /**
   * <p>Allows grantee to write the ACL for the applicable object.</p>
   *          <note>
   *             <ul>
   *                <li>
   *                   <p>This functionality is not supported for directory buckets.</p>
   *                </li>
   *                <li>
   *                   <p>This functionality is not supported for Amazon S3 on Outposts.</p>
   *                </li>
   *             </ul>
   *          </note>
   */
  GrantWriteACP?: string;
  /**
   * <p>Object key for which the PUT action was initiated.</p>
   */
  Key: string | undefined;
  /**
   * <p>A map of metadata to store with the object in S3.</p>
   */
  Metadata?: Record<string, string>;
  /**
   * <p>The server-side encryption algorithm that was used when you store this object in Amazon S3 (for example,
   *             <code>AES256</code>, <code>aws:kms</code>, <code>aws:kms:dsse</code>).</p>
   *          <p>
   *             <b>General purpose buckets </b> - You have four mutually exclusive options to protect data using server-side encryption in
   *                Amazon S3, depending on how you choose to manage the encryption keys. Specifically, the
   *                encryption key options are Amazon S3 managed keys (SSE-S3), Amazon Web Services KMS keys (SSE-KMS or
   *                DSSE-KMS), and customer-provided keys (SSE-C). Amazon S3 encrypts data with server-side
   *                encryption by using Amazon S3 managed keys (SSE-S3) by default. You can optionally tell Amazon S3 to
   *                encrypt data at rest by using server-side encryption with other key options. For more
   *                information, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingServerSideEncryption.html">Using Server-Side
   *                   Encryption</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <p>
   *             <b>Directory buckets </b> - For directory buckets, only the server-side encryption with Amazon S3 managed keys (SSE-S3) (<code>AES256</code>) value is supported.</p>
   */
  ServerSideEncryption?: ServerSideEncryption;
  /**
   * <p>By default, Amazon S3 uses the STANDARD Storage Class to store newly created objects. The
   *          STANDARD storage class provides high durability and high availability. Depending on
   *          performance needs, you can specify a different Storage Class. For more information, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/storage-class-intro.html">Storage Classes</a> in the
   *             <i>Amazon S3 User Guide</i>.</p>
   *          <note>
   *             <ul>
   *                <li>
   *                   <p>For directory buckets, only the S3 Express One Zone storage class is supported to store newly created objects.</p>
   *                </li>
   *                <li>
   *                   <p>Amazon S3 on Outposts only uses
   *                the OUTPOSTS Storage Class.</p>
   *                </li>
   *             </ul>
   *          </note>
   */
  StorageClass?: StorageClass;
  /**
   * <p>If the bucket is configured as a website, redirects requests for this object to another
   *          object in the same bucket or to an external URL. Amazon S3 stores the value of this header in
   *          the object metadata. For information about object metadata, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html">Object Key and Metadata</a> in the <i>Amazon S3
   *                User Guide</i>.</p>
   *          <p>In the following example, the request header sets the redirect to an object
   *          (anotherPage.html) in the same bucket:</p>
   *          <p>
   *             <code>x-amz-website-redirect-location: /anotherPage.html</code>
   *          </p>
   *          <p>In the following example, the request header sets the object redirect to another
   *          website:</p>
   *          <p>
   *             <code>x-amz-website-redirect-location: http://www.example.com/</code>
   *          </p>
   *          <p>For more information about website hosting in Amazon S3, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/WebsiteHosting.html">Hosting Websites on Amazon S3</a> and
   *             <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/how-to-page-redirect.html">How to
   *                Configure Website Page Redirects</a> in the <i>Amazon S3
   *                   User Guide</i>. </p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  WebsiteRedirectLocation?: string;
  /**
   * <p>Specifies the algorithm to use when encrypting the object (for example,
   *          <code>AES256</code>).</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  SSECustomerAlgorithm?: string;
  /**
   * <p>Specifies the customer-provided encryption key for Amazon S3 to use in encrypting data. This
   *          value is used to store the object and then it is discarded; Amazon S3 does not store the
   *          encryption key. The key must be appropriate for use with the algorithm specified in the
   *             <code>x-amz-server-side-encryption-customer-algorithm</code> header.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  SSECustomerKey?: string;
  /**
   * <p>Specifies the 128-bit MD5 digest of the encryption key according to RFC 1321. Amazon S3 uses
   *          this header for a message integrity check to ensure that the encryption key was transmitted
   *          without error.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  SSECustomerKeyMD5?: string;
  /**
   * <p>If <code>x-amz-server-side-encryption</code> has a valid value of <code>aws:kms</code>
   *          or <code>aws:kms:dsse</code>, this header specifies the ID (Key ID, Key ARN, or Key Alias) of the Key Management Service (KMS)
   *          symmetric encryption customer managed key that was used for the object. If you specify
   *             <code>x-amz-server-side-encryption:aws:kms</code> or
   *             <code>x-amz-server-side-encryption:aws:kms:dsse</code>, but do not provide<code>
   *             x-amz-server-side-encryption-aws-kms-key-id</code>, Amazon S3 uses the Amazon Web Services managed key
   *             (<code>aws/s3</code>) to protect the data. If the KMS key does not exist in the same
   *          account that's issuing the command, you must use the full ARN and not just the ID. </p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  SSEKMSKeyId?: string;
  /**
   * <p>Specifies the Amazon Web Services KMS Encryption Context to use for object encryption. The value of
   *          this header is a base64-encoded UTF-8 string holding JSON with the encryption context
   *          key-value pairs. This value is stored as object metadata and automatically gets passed on
   *          to Amazon Web Services KMS for future <code>GetObject</code> or <code>CopyObject</code> operations on
   *          this object. This value must be explicitly added during <code>CopyObject</code> operations.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  SSEKMSEncryptionContext?: string;
  /**
   * <p>Specifies whether Amazon S3 should use an S3 Bucket Key for object encryption with
   *          server-side encryption using Key Management Service (KMS) keys (SSE-KMS). Setting this header to
   *             <code>true</code> causes Amazon S3 to use an S3 Bucket Key for object encryption with
   *          SSE-KMS.</p>
   *          <p>Specifying this header with a PUT action doesn’t affect bucket-level settings for S3
   *          Bucket Key.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  BucketKeyEnabled?: boolean;
  /**
   * <p>Confirms that the requester knows that they will be charged for the request. Bucket
   *          owners need not specify this parameter in their requests. If either the source or
   *          destination S3 bucket has Requester Pays enabled, the requester will pay for
   *          corresponding charges to copy the object. For information about downloading objects from
   *          Requester Pays buckets, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/ObjectsinRequesterPaysBuckets.html">Downloading Objects in
   *             Requester Pays Buckets</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  RequestPayer?: RequestPayer;
  /**
   * <p>The tag-set for the object. The tag-set must be encoded as URL Query parameters. (For
   *          example, "Key1=Value1")</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  Tagging?: string;
  /**
   * <p>The Object Lock mode that you want to apply to this object.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  ObjectLockMode?: ObjectLockMode;
  /**
   * <p>The date and time when you want this object's Object Lock to expire. Must be formatted
   *          as a timestamp parameter.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  ObjectLockRetainUntilDate?: Date;
  /**
   * <p>Specifies whether a legal hold will be applied to this object. For more information
   *          about S3 Object Lock, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/dev/object-lock.html">Object Lock</a> in the <i>Amazon S3 User Guide</i>.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  ObjectLockLegalHoldStatus?: ObjectLockLegalHoldStatus;
  /**
   * <p>The account ID of the expected bucket owner. If the account ID that you provide does not match the actual owner of the bucket, the request fails with the HTTP status code <code>403 Forbidden</code> (access denied).</p>
   */
  ExpectedBucketOwner?: string;
}

export type NodeJsRuntimeStreamingBlobPayloadInputTypes = string | Uint8Array | Buffer | Readable;

export interface PutObjectCommandInput extends Omit<PutObjectRequest, 'Body'> {
  Body?: NodeJsRuntimeStreamingBlobPayloadInputTypes;
}

export interface CompleteMultipartUploadOutput {
  /**
   * <p>The URI that identifies the newly created object.</p>
   */
  Location?: string;
  /**
   * <p>The name of the bucket that contains the newly created object. Does not return the access point
   *          ARN or access point alias if used.</p>
   *          <note>
   *             <p>Access points are not supported by directory buckets.</p>
   *          </note>
   */
  Bucket?: string;
  /**
   * <p>The object key of the newly created object.</p>
   */
  Key?: string;
  /**
   * <p>If the object expiration is configured, this will contain the expiration date
   *             (<code>expiry-date</code>) and rule ID (<code>rule-id</code>). The value of
   *             <code>rule-id</code> is URL-encoded.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  Expiration?: string;
  /**
   * <p>Entity tag that identifies the newly created object's data. Objects with different
   *          object data will have different entity tags. The entity tag is an opaque string. The entity
   *          tag may or may not be an MD5 digest of the object data. If the entity tag is not an MD5
   *          digest of the object data, it will contain one or more nonhexadecimal characters and/or
   *          will consist of less than 32 or more than 32 hexadecimal digits. For more information about
   *          how the entity tag is calculated, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html">Checking object
   *             integrity</a> in the <i>Amazon S3 User Guide</i>.</p>
   */
  ETag?: string;
  /**
   * <p>The base64-encoded, 32-bit CRC32 checksum of the object. This will only be present if it was uploaded
   *     with the object. When you use an API operation on an object that was uploaded using multipart uploads, this value may not be a direct checksum value of the full object. Instead, it's a calculation based on the checksum values of each individual part. For more information about how checksums are calculated
   *     with multipart uploads, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html#large-object-checksums">
   *     Checking object integrity</a> in the <i>Amazon S3 User Guide</i>.</p>
   */
  ChecksumCRC32?: string;
  /**
   * <p>The base64-encoded, 32-bit CRC32C checksum of the object. This will only be present if it was uploaded
   *     with the object. When you use an API operation on an object that was uploaded using multipart uploads, this value may not be a direct checksum value of the full object. Instead, it's a calculation based on the checksum values of each individual part. For more information about how checksums are calculated
   *     with multipart uploads, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html#large-object-checksums">
   *     Checking object integrity</a> in the <i>Amazon S3 User Guide</i>.</p>
   */
  ChecksumCRC32C?: string;
  /**
   * <p>The base64-encoded, 160-bit SHA-1 digest of the object. This will only be present if it was uploaded
   *     with the object. When you use the API operation on an object that was uploaded using multipart uploads, this value may not be a direct checksum value of the full object. Instead, it's a calculation based on the checksum values of each individual part. For more information about how checksums are calculated
   *     with multipart uploads, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html#large-object-checksums">
   *     Checking object integrity</a> in the <i>Amazon S3 User Guide</i>.</p>
   */
  ChecksumSHA1?: string;
  /**
   * <p>The base64-encoded, 256-bit SHA-256 digest of the object. This will only be present if it was uploaded
   *     with the object. When you use an API operation on an object that was uploaded using multipart uploads, this value may not be a direct checksum value of the full object. Instead, it's a calculation based on the checksum values of each individual part. For more information about how checksums are calculated
   *     with multipart uploads, see <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html#large-object-checksums">
   *     Checking object integrity</a> in the <i>Amazon S3 User Guide</i>.</p>
   */
  ChecksumSHA256?: string;
  /**
   * <p>The server-side encryption algorithm used when storing this object in Amazon S3 (for example,
   *             <code>AES256</code>, <code>aws:kms</code>).</p>
   *          <note>
   *             <p>For directory buckets, only server-side encryption with Amazon S3 managed keys (SSE-S3) (<code>AES256</code>) is supported.</p>
   *          </note>
   */
  ServerSideEncryption?: ServerSideEncryption;
  /**
   * <p>Version ID of the newly created object, in case the bucket has versioning turned
   *          on.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  VersionId?: string;
  /**
   * <p>If present, indicates the ID of the Key Management Service (KMS) symmetric encryption customer managed key
   *          that was used for the object.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  SSEKMSKeyId?: string;
  /**
   * <p>Indicates whether the multipart upload uses an S3 Bucket Key for server-side encryption
   *          with Key Management Service (KMS) keys (SSE-KMS).</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  BucketKeyEnabled?: boolean;
  /**
   * <p>If present, indicates that the requester was successfully charged for the
   *          request.</p>
   *          <note>
   *             <p>This functionality is not supported for directory buckets.</p>
   *          </note>
   */
  RequestCharged?: RequestCharged;
}

export interface CompleteMultipartUploadCommandOutput
  extends CompleteMultipartUploadOutput,
  MetadataBearer {
}

export interface ImageIdentifier {
  /**
   * <p>The <code>sha256</code> digest of the image manifest.</p>
   */
  imageDigest?: string;
  /**
   * <p>The tag used for the image.</p>
   */
  imageTag?: string;
}

export interface DescribeImagesFilter {
  /**
   * <p>The tag status with which to filter your <a>DescribeImages</a> results. You
   *             can filter results based on whether they are <code>TAGGED</code> or
   *                 <code>UNTAGGED</code>.</p>
   */
  tagStatus?: TagStatus;
}

export const TagStatus = {
  ANY: 'ANY',
  TAGGED: 'TAGGED',
  UNTAGGED: 'UNTAGGED',
} as const;

export type TagStatus = (typeof TagStatus)[keyof typeof TagStatus];

export interface DescribeImagesRequest {
  /**
   * <p>The Amazon Web Services account ID associated with the registry that contains the repository in
   *             which to describe images. If you do not specify a registry, the default registry is assumed.</p>
   */
  registryId?: string;
  /**
   * <p>The repository that contains the images to describe.</p>
   */
  repositoryName: string | undefined;
  /**
   * <p>The list of image IDs for the requested repository.</p>
   */
  imageIds?: ImageIdentifier[];
  /**
   * <p>The <code>nextToken</code> value returned from a previous paginated
   *                 <code>DescribeImages</code> request where <code>maxResults</code> was used and the
   *             results exceeded the value of that parameter. Pagination continues from the end of the
   *             previous results that returned the <code>nextToken</code> value. This value is
   *                 <code>null</code> when there are no more results to return. This option cannot be
   *             used when you specify images with <code>imageIds</code>.</p>
   */
  nextToken?: string;
  /**
   * <p>The maximum number of repository results returned by <code>DescribeImages</code> in
   *             paginated output. When this parameter is used, <code>DescribeImages</code> only returns
   *                 <code>maxResults</code> results in a single page along with a <code>nextToken</code>
   *             response element. The remaining results of the initial request can be seen by sending
   *             another <code>DescribeImages</code> request with the returned <code>nextToken</code>
   *             value. This value can be between 1 and 1000. If this
   *             parameter is not used, then <code>DescribeImages</code> returns up to
   *             100 results and a <code>nextToken</code> value, if applicable. This
   *             option cannot be used when you specify images with <code>imageIds</code>.</p>
   */
  maxResults?: number;
  /**
   * <p>The filter key and value with which to filter your <code>DescribeImages</code>
   *             results.</p>
   */
  filter?: DescribeImagesFilter;
}

export interface DescribeImagesCommandInput extends DescribeImagesRequest {
}

export interface DescribeImagesCommandOutput extends DescribeImagesResponse, MetadataBearer {
}

export const ScanStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
  FINDINGS_UNAVAILABLE: 'FINDINGS_UNAVAILABLE',
  IN_PROGRESS: 'IN_PROGRESS',
  PENDING: 'PENDING',
  SCAN_ELIGIBILITY_EXPIRED: 'SCAN_ELIGIBILITY_EXPIRED',
  UNSUPPORTED_IMAGE: 'UNSUPPORTED_IMAGE',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
} as const;

export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const FindingSeverity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  INFORMATIONAL: 'INFORMATIONAL',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  UNDEFINED: 'UNDEFINED',
} as const;

/**
 */
export type FindingSeverity = (typeof FindingSeverity)[keyof typeof FindingSeverity];

export interface ImageScanStatus {
  /**
   * <p>The current state of an image scan.</p>
   */
  status?: ScanStatus;
  /**
   * <p>The description of the image scan status.</p>
   */
  description?: string;
}

export interface ImageScanFindingsSummary {
  /**
   * <p>The time of the last completed image scan.</p>
   */
  imageScanCompletedAt?: Date;
  /**
   * <p>The time when the vulnerability data was last scanned.</p>
   */
  vulnerabilitySourceUpdatedAt?: Date;
  /**
   * <p>The image vulnerability counts, sorted by severity.</p>
   */
  findingSeverityCounts?: Partial<Record<FindingSeverity, number>>;
}

export interface ImageDetail {
  /**
   * <p>The Amazon Web Services account ID associated with the registry to which this image belongs.</p>
   */
  registryId?: string;
  /**
   * <p>The name of the repository to which this image belongs.</p>
   */
  repositoryName?: string;
  /**
   * <p>The <code>sha256</code> digest of the image manifest.</p>
   */
  imageDigest?: string;
  /**
   * <p>The list of tags associated with this image.</p>
   */
  imageTags?: string[];
  /**
   * <p>The size, in bytes, of the image in the repository.</p>
   *          <p>If the image is a manifest list, this will be the max size of all manifests in the
   *             list.</p>
   *          <note>
   *             <p>Beginning with Docker version 1.9, the Docker client compresses image layers
   *                 before pushing them to a V2 Docker registry. The output of the <code>docker
   *                     images</code> command shows the uncompressed image size, so it may return a
   *                 larger image size than the image sizes returned by <a>DescribeImages</a>.</p>
   *          </note>
   */
  imageSizeInBytes?: number;
  /**
   * <p>The date and time, expressed in standard JavaScript date format, at which the current
   *             image was pushed to the repository. </p>
   */
  imagePushedAt?: Date;
  /**
   * <p>The current state of the scan.</p>
   */
  imageScanStatus?: ImageScanStatus;
  /**
   * <p>A summary of the last completed image scan.</p>
   */
  imageScanFindingsSummary?: ImageScanFindingsSummary;
  /**
   * <p>The media type of the image manifest.</p>
   */
  imageManifestMediaType?: string;
  /**
   * <p>The artifact media type of the image.</p>
   */
  artifactMediaType?: string;
  /**
   * <p>The date and time, expressed in standard JavaScript date format, when Amazon ECR recorded
   *             the last image pull.</p>
   *          <note>
   *             <p>Amazon ECR refreshes the last image pull timestamp at least once every 24 hours. For
   *                 example, if you pull an image once a day then the <code>lastRecordedPullTime</code>
   *                 timestamp will indicate the exact time that the image was last pulled. However, if
   *                 you pull an image once an hour, because Amazon ECR refreshes the
   *                     <code>lastRecordedPullTime</code> timestamp at least once every 24 hours, the
   *                 result may not be the exact time that the image was last pulled.</p>
   *          </note>
   */
  lastRecordedPullTime?: Date;
}

export interface DescribeImagesResponse {
  /**
   * <p>A list of <a>ImageDetail</a> objects that contain data about the
   *             image.</p>
   */
  imageDetails?: ImageDetail[];
  /**
   * <p>The <code>nextToken</code> value to include in a future <code>DescribeImages</code>
   *             request. When the results of a <code>DescribeImages</code> request exceed
   *                 <code>maxResults</code>, this value can be used to retrieve the next page of
   *             results. This value is <code>null</code> when there are no more results to
   *             return.</p>
   */
  nextToken?: string;
}

export interface DescribeRepositoriesRequest {
  /**
   * <p>The Amazon Web Services account ID associated with the registry that contains the repositories to be
   *             described. If you do not specify a registry, the default registry is assumed.</p>
   */
  registryId?: string;
  /**
   * <p>A list of repositories to describe. If this parameter is omitted, then all
   *             repositories in a registry are described.</p>
   */
  repositoryNames?: string[];
  /**
   * <p>The <code>nextToken</code> value returned from a previous paginated
   *                 <code>DescribeRepositories</code> request where <code>maxResults</code> was used and
   *             the results exceeded the value of that parameter. Pagination continues from the end of
   *             the previous results that returned the <code>nextToken</code> value. This value is
   *                 <code>null</code> when there are no more results to return. This option cannot be
   *             used when you specify repositories with <code>repositoryNames</code>.</p>
   *          <note>
   *             <p>This token should be treated as an opaque identifier that is only used to
   *                 retrieve the next items in a list and not for other programmatic purposes.</p>
   *          </note>
   */
  nextToken?: string;
  /**
   * <p>The maximum number of repository results returned by <code>DescribeRepositories</code>
   *             in paginated output. When this parameter is used, <code>DescribeRepositories</code> only
   *             returns <code>maxResults</code> results in a single page along with a
   *                 <code>nextToken</code> response element. The remaining results of the initial
   *             request can be seen by sending another <code>DescribeRepositories</code> request with
   *             the returned <code>nextToken</code> value. This value can be between 1
   *             and 1000. If this parameter is not used, then
   *                 <code>DescribeRepositories</code> returns up to 100 results and a
   *                 <code>nextToken</code> value, if applicable. This option cannot be used when you
   *             specify repositories with <code>repositoryNames</code>.</p>
   */
  maxResults?: number;
}

export interface DescribeRepositoriesCommandInput extends DescribeRepositoriesRequest {
}

export const ImageTagMutability = {
  IMMUTABLE: 'IMMUTABLE',
  MUTABLE: 'MUTABLE',
} as const;

/**
 */
export type ImageTagMutability = (typeof ImageTagMutability)[keyof typeof ImageTagMutability];

export interface ImageScanningConfiguration {
  /**
   * <p>The setting that determines whether images are scanned after being pushed to a
   *             repository. If set to <code>true</code>, images will be scanned after being pushed. If
   *             this parameter is not specified, it will default to <code>false</code> and images will
   *             not be scanned unless a scan is manually started with the <a href="https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_StartImageScan.html">API_StartImageScan</a> API.</p>
   */
  scanOnPush?: boolean;
}

export const EncryptionType = {
  AES256: 'AES256',
  KMS: 'KMS',
  KMS_DSSE: 'KMS_DSSE',
} as const;

/**
 */
export type EncryptionType = (typeof EncryptionType)[keyof typeof EncryptionType];

export interface EncryptionConfiguration {
  /**
   * <p>The encryption type to use.</p>
   *          <p>If you use the <code>KMS</code> encryption type, the contents of the repository will
   *             be encrypted using server-side encryption with Key Management Service key stored in KMS. When you
   *             use KMS to encrypt your data, you can either use the default Amazon Web Services managed KMS key
   *             for Amazon ECR, or specify your own KMS key, which you already created.</p>
   *          <p>If you use the <code>KMS_DSSE</code> encryption type, the contents of the repository
   *             will be encrypted with two layers of encryption using server-side encryption with the
   *             KMS Management Service key stored in KMS. Similar to the <code>KMS</code> encryption type, you
   *             can either use the default Amazon Web Services managed KMS key for Amazon ECR, or specify your own KMS
   *             key, which you've already created. </p>
   *          <p>If you use the <code>AES256</code> encryption type, Amazon ECR uses server-side encryption
   *             with Amazon S3-managed encryption keys which encrypts the images in the repository using an
   *             AES256 encryption algorithm.</p>
   *          <p>For more information, see <a href="https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html">Amazon ECR encryption at
   *             rest</a> in the <i>Amazon Elastic Container Registry User Guide</i>.</p>
   */
  encryptionType: EncryptionType | undefined;

  /**
   * <p>If you use the <code>KMS</code> encryption type, specify the KMS key to use for
   *             encryption. The alias, key ID, or full ARN of the KMS key can be specified. The key
   *             must exist in the same Region as the repository. If no key is specified, the default
   *             Amazon Web Services managed KMS key for Amazon ECR will be used.</p>
   */
  kmsKey?: string;
}

export interface Repository {
  /**
   * <p>The Amazon Resource Name (ARN) that identifies the repository. The ARN contains the <code>arn:aws:ecr</code> namespace, followed by the region of the
   *     repository, Amazon Web Services account ID of the repository owner, repository namespace, and repository name.
   *     For example, <code>arn:aws:ecr:region:012345678910:repository-namespace/repository-name</code>.</p>
   */
  repositoryArn?: string;

  /**
   * <p>The Amazon Web Services account ID associated with the registry that contains the repository.</p>
   */
  registryId?: string;

  /**
   * <p>The name of the repository.</p>
   */
  repositoryName?: string;

  /**
   * <p>The URI for the repository. You can use this URI for container image <code>push</code>
   *             and <code>pull</code> operations.</p>
   */
  repositoryUri?: string;

  /**
   * <p>The date and time, in JavaScript date format, when the repository was created.</p>
   */
  createdAt?: Date;

  /**
   * <p>The tag mutability setting for the repository.</p>
   */
  imageTagMutability?: ImageTagMutability;

  /**
   * <p>The image scanning configuration for a repository.</p>
   */
  imageScanningConfiguration?: ImageScanningConfiguration;

  /**
   * <p>The encryption configuration for the repository. This determines how the contents of
   *             your repository are encrypted at rest.</p>
   */
  encryptionConfiguration?: EncryptionConfiguration;
}

export interface DescribeRepositoriesResponse {
  /**
   * <p>A list of repository objects corresponding to valid repositories.</p>
   */
  repositories?: Repository[];
  /**
   * <p>The <code>nextToken</code> value to include in a future
   *                 <code>DescribeRepositories</code> request. When the results of a
   *                 <code>DescribeRepositories</code> request exceed <code>maxResults</code>, this value
   *             can be used to retrieve the next page of results. This value is <code>null</code> when
   *             there are no more results to return.</p>
   */
  nextToken?: string;
}

export interface DescribeRepositoriesCommandOutput
  extends DescribeRepositoriesResponse,
  MetadataBearer {
}

export interface GetAuthorizationTokenRequest {
  /**
   * @deprecated
   *
   * <p>A list of Amazon Web Services account IDs that are associated with the registries for which to get
   *             AuthorizationData objects. If you do not specify a registry, the default registry is assumed.</p>
   */
  registryIds?: string[];
}

export interface GetAuthorizationTokenCommandInput extends GetAuthorizationTokenRequest {
}

export interface AuthorizationData {
  /**
   * <p>A base64-encoded string that contains authorization data for the specified Amazon ECR
   *             registry. When the string is decoded, it is presented in the format
   *                 <code>user:password</code> for private registry authentication using <code>docker
   *                 login</code>.</p>
   */
  authorizationToken?: string;
  /**
   * <p>The Unix time in seconds and milliseconds when the authorization token expires.
   *             Authorization tokens are valid for 12 hours.</p>
   */
  expiresAt?: Date;
  /**
   * <p>The registry URL to use for this authorization token in a <code>docker login</code>
   *             command. The Amazon ECR registry URL format is
   *         <code>https://aws_account_id.dkr.ecr.region.amazonaws.com</code>. For example,
   *         <code>https://012345678910.dkr.ecr.us-east-1.amazonaws.com</code>.. </p>
   */
  proxyEndpoint?: string;
}

export interface GetAuthorizationTokenResponse {
  /**
   * <p>A list of authorization token data objects that correspond to the
   *                 <code>registryIds</code> values in the request.</p>
   */
  authorizationData?: AuthorizationData[];
}

export interface GetAuthorizationTokenCommandOutput
  extends GetAuthorizationTokenResponse,
  MetadataBearer {
}

export interface GetSecretValueRequest {
  /**
   * <p>The ARN or name of the secret to retrieve. To retrieve a secret from another account, you must use an ARN.</p>
   *          <p>For an ARN, we recommend that you specify a complete ARN rather
   *       than a partial ARN. See <a href="https://docs.aws.amazon.com/secretsmanager/latest/userguide/troubleshoot.html#ARN_secretnamehyphen">Finding a secret from a partial ARN</a>.</p>
   */
  SecretId: string | undefined;
  /**
   * <p>The unique identifier of the version of the secret to retrieve. If
   *       you include both this parameter and <code>VersionStage</code>, the two parameters must refer
   *       to the same secret version. If you don't specify either a <code>VersionStage</code> or
   *         <code>VersionId</code>, then Secrets Manager returns the <code>AWSCURRENT</code> version.</p>
   *          <p>This value is typically a <a href="https://wikipedia.org/wiki/Universally_unique_identifier">UUID-type</a> value with
   *       32 hexadecimal digits.</p>
   */
  VersionId?: string;
  /**
   * <p>The staging label of the version of the secret to retrieve. </p>
   *          <p>Secrets Manager uses staging labels to keep track of different versions during the rotation process.
   *       If you include both this parameter and <code>VersionId</code>, the two parameters must refer
   *       to the same secret version. If you don't specify either a <code>VersionStage</code> or
   *       <code>VersionId</code>, Secrets Manager returns the <code>AWSCURRENT</code> version.</p>
   */
  VersionStage?: string;
}

export interface GetSecretValueCommandInput extends GetSecretValueRequest {
}

export interface GetSecretValueResponse {
  /**
   * <p>The ARN of the secret.</p>
   */
  ARN?: string;
  /**
   * <p>The friendly name of the secret.</p>
   */
  Name?: string;
  /**
   * <p>The unique identifier of this version of the secret.</p>
   */
  VersionId?: string;
  /**
   * <p>The decrypted secret value, if the secret value was originally provided as
   *       binary data in the form of a byte array. When you retrieve a <code>SecretBinary</code> using the HTTP API, the Python SDK, or the Amazon Web Services CLI, the value is Base64-encoded. Otherwise, it is not encoded.</p>
   *          <p>If the secret was created by using the Secrets Manager console, or if the secret value was
   *       originally provided as a string, then this field is omitted. The secret value appears in
   *       <code>SecretString</code> instead.</p>
   *          <p>Sensitive: This field contains sensitive information, so the service does not include it in CloudTrail log entries. If you create your own log entries, you must also avoid logging the information in this field.</p>
   */
  SecretBinary?: Uint8Array;
  /**
   * <p>The decrypted secret value, if the secret value was originally provided as a string or
   *       through the Secrets Manager console.</p>
   *          <p>If this secret was created by using the console, then Secrets Manager stores the information as a
   *       JSON structure of key/value pairs. </p>
   *          <p>Sensitive: This field contains sensitive information, so the service does not include it in CloudTrail log entries. If you create your own log entries, you must also avoid logging the information in this field.</p>
   */
  SecretString?: string;
  /**
   * <p>A list of all of the staging labels currently attached to this version of the
   *       secret.</p>
   */
  VersionStages?: string[];
  /**
   * <p>The date and time that this version of the secret was created. If you don't specify
   *       which version in <code>VersionId</code> or <code>VersionStage</code>, then Secrets Manager uses the
   *       <code>AWSCURRENT</code> version.</p>
   */
  CreatedDate?: Date;
}

export interface GetSecretValueCommandOutput extends GetSecretValueResponse, MetadataBearer {
}
