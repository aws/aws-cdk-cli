import * as os from 'os';
import {
  DescribeImagesCommand,
  DescribeRepositoriesCommand,
  ECRClient,
  GetAuthorizationTokenCommand,
} from '@aws-sdk/client-ecr';
import {
  GetBucketEncryptionCommand,
  GetBucketLocationCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  AssumeRoleCommandInput,
  GetCallerIdentityCommand,
  STSClient,
  STSClientConfig,
} from '@aws-sdk/client-sts';
import { fromNodeProviderChain, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { Upload } from '@aws-sdk/lib-storage';
import {
  NODE_REGION_CONFIG_FILE_OPTIONS,
  NODE_REGION_CONFIG_OPTIONS,
} from '@smithy/config-resolver';
import { loadConfig } from '@smithy/node-config-provider';
import {
  AwsCredentialIdentityProvider,
  CompleteMultipartUploadCommandOutput,
  DescribeImagesCommandInput,
  DescribeImagesCommandOutput,
  DescribeRepositoriesCommandInput,
  DescribeRepositoriesCommandOutput,
  GetAuthorizationTokenCommandInput,
  GetAuthorizationTokenCommandOutput,
  GetBucketEncryptionCommandInput,
  GetBucketEncryptionCommandOutput,
  GetBucketLocationCommandInput,
  GetBucketLocationCommandOutput,
  GetSecretValueCommandInput,
  GetSecretValueCommandOutput,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  PutObjectCommandInput,
} from './aws-types';

export type AssumeRoleAdditionalOptions = Partial<
  Omit<AssumeRoleCommandInput, 'ExternalId' | 'RoleArn'>
>;

export interface IS3Client {
  getBucketEncryption(
    input: GetBucketEncryptionCommandInput
  ): Promise<GetBucketEncryptionCommandOutput>;
  getBucketLocation(input: GetBucketLocationCommandInput): Promise<GetBucketLocationCommandOutput>;
  listObjectsV2(input: ListObjectsV2CommandInput): Promise<ListObjectsV2CommandOutput>;
  upload(input: PutObjectCommandInput): Promise<CompleteMultipartUploadCommandOutput>;
}

export interface IECRClient {
  describeImages(input: DescribeImagesCommandInput): Promise<DescribeImagesCommandOutput>;
  describeRepositories(
    input: DescribeRepositoriesCommandInput
  ): Promise<DescribeRepositoriesCommandOutput>;
  getAuthorizationToken(
    input?: GetAuthorizationTokenCommandInput
  ): Promise<GetAuthorizationTokenCommandOutput>;
}

export interface ISecretsManagerClient {
  getSecretValue(input: GetSecretValueCommandInput): Promise<GetSecretValueCommandOutput>;
}

/**
 * AWS SDK operations required by Asset Publishing
 */
export interface IAws {
  discoverPartition(): Promise<string>;
  discoverDefaultRegion(): Promise<string>;
  discoverCurrentAccount(): Promise<Account>;

  discoverTargetAccount(options: ClientOptions): Promise<Account>;
  s3Client(options: ClientOptions): Promise<IS3Client>;
  ecrClient(options: ClientOptions): Promise<IECRClient>;
  secretsManagerClient(options: ClientOptions): Promise<ISecretsManagerClient>;
}

export interface ClientOptions {
  region?: string;
  assumeRoleArn?: string;
  assumeRoleExternalId?: string;
  assumeRoleAdditionalOptions?: AssumeRoleAdditionalOptions;
  quiet?: boolean;
}

const USER_AGENT = 'cdk-assets';

interface Configuration {
  clientConfig: STSClientConfig;
  region?: string;
  credentials: AwsCredentialIdentityProvider;
}

/**
 * An AWS account
 *
 * An AWS account always exists in only one partition. Usually we don't care about
 * the partition, but when we need to form ARNs we do.
 */
export interface Account {
  /**
   * The account number
   */
  readonly accountId: string;

  /**
   * The partition ('aws' or 'aws-cn' or otherwise)
   */
  readonly partition: string;
}

/**
 * AWS client using the AWS SDK for JS with no special configuration
 */
export class DefaultAwsClient implements IAws {
  private account?: Account;
  private config: Configuration;

  constructor(private readonly profile?: string) {
    const clientConfig: STSClientConfig = {
      customUserAgent: USER_AGENT,
    };
    this.config = {
      clientConfig,
      credentials: fromNodeProviderChain({
        profile: this.profile,
        clientConfig,
      }),
    };
  }

  public async s3Client(options: ClientOptions): Promise<IS3Client> {
    const client = new S3Client(await this.awsOptions(options));
    return {
      getBucketEncryption: (
        input: GetBucketEncryptionCommandInput,
      ): Promise<GetBucketEncryptionCommandOutput> =>
        client.send(new GetBucketEncryptionCommand(input)),
      getBucketLocation: (
        input: GetBucketLocationCommandInput,
      ): Promise<GetBucketLocationCommandOutput> =>
        client.send(new GetBucketLocationCommand(input)),
      listObjectsV2: (input: ListObjectsV2CommandInput): Promise<ListObjectsV2CommandOutput> =>
        client.send(new ListObjectsV2Command(input)),
      upload: (input: PutObjectCommandInput): Promise<CompleteMultipartUploadCommandOutput> => {
        const upload = new Upload({
          client,
          params: input,
        });
        return upload.done();
      },
    };
  }

  public async ecrClient(options: ClientOptions): Promise<IECRClient> {
    const client = new ECRClient(await this.awsOptions(options));
    return {
      describeImages: (input: DescribeImagesCommandInput): Promise<DescribeImagesCommandOutput> =>
        client.send(new DescribeImagesCommand(input)),
      describeRepositories: (
        input: DescribeRepositoriesCommandInput,
      ): Promise<DescribeRepositoriesCommandOutput> =>
        client.send(new DescribeRepositoriesCommand(input)),
      getAuthorizationToken: (
        input: GetAuthorizationTokenCommandInput,
      ): Promise<GetAuthorizationTokenCommandOutput> =>
        client.send(new GetAuthorizationTokenCommand(input ?? {})),
    };
  }

  public async secretsManagerClient(options: ClientOptions): Promise<ISecretsManagerClient> {
    const client = new SecretsManagerClient(await this.awsOptions(options));
    return {
      getSecretValue: (input: GetSecretValueCommandInput): Promise<GetSecretValueCommandOutput> =>
        client.send(new GetSecretValueCommand(input)),
    };
  }

  public async discoverPartition(): Promise<string> {
    return (await this.discoverCurrentAccount()).partition;
  }

  public async discoverDefaultRegion(): Promise<string> {
    return loadConfig(NODE_REGION_CONFIG_OPTIONS, NODE_REGION_CONFIG_FILE_OPTIONS)() || 'us-east-1';
  }

  public async discoverCurrentAccount(): Promise<Account> {
    if (this.account === undefined) {
      this.account = await this.getAccount();
    }
    return this.account;
  }

  public async discoverTargetAccount(options: ClientOptions): Promise<Account> {
    return this.getAccount(await this.awsOptions(options));
  }

  private async getAccount(options?: ClientOptions): Promise<Account> {
    this.config.clientConfig = options ?? this.config.clientConfig;
    const stsClient = new STSClient(await this.awsOptions(options));

    const command = new GetCallerIdentityCommand();
    const response = await stsClient.send(command);
    if (!response.Account || !response.Arn) {
      throw new Error(`Unrecognized response from STS: '${JSON.stringify(response)}'`);
    }
    return {
      accountId: response.Account!,
      partition: response.Arn!.split(':')[1],
    };
  }

  private async awsOptions(options?: ClientOptions) {
    const config = this.config;
    config.region = options?.region;
    if (options) {
      config.region = options.region;
      if (options.assumeRoleArn) {
        config.credentials = fromTemporaryCredentials({
          // dont forget the credentials chain.
          masterCredentials: config.credentials,
          params: {
            RoleArn: options.assumeRoleArn,
            ExternalId: options.assumeRoleExternalId,
            RoleSessionName: `${USER_AGENT}-${safeUsername()}`,
            TransitiveTagKeys: options.assumeRoleAdditionalOptions?.Tags
              ? options.assumeRoleAdditionalOptions.Tags.map((t) => t.Key!)
              : undefined,
            ...options.assumeRoleAdditionalOptions,
          },
          clientConfig: this.config.clientConfig,
        });
      }
    }
    return config;
  }
}

/**
 * Return the username with characters invalid for a RoleSessionName removed
 *
 * @see https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html#API_AssumeRole_RequestParameters
 */
function safeUsername() {
  try {
    return os.userInfo().username.replace(/[^\w+=,.@-]/g, '@');
  } catch {
    return 'noname';
  }
}
