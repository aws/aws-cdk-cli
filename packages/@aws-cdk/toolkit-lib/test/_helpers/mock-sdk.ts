import 'aws-sdk-client-mock-jest';
import { type Account } from '@aws-cdk/cdk-assets-lib';
import type { SDKv3CompatibleCredentials } from '@aws-cdk/cli-plugin-contract';
import type { Environment } from '@aws-cdk/cx-api';
import { AppSyncClient } from '@aws-sdk/client-appsync';
import { CloudControlClient } from '@aws-sdk/client-cloudcontrol';
import type { Stack } from '@aws-sdk/client-cloudformation';
import { CloudFormationClient, StackStatus } from '@aws-sdk/client-cloudformation';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { EC2Client } from '@aws-sdk/client-ec2';
import { ECRClient } from '@aws-sdk/client-ecr';
import { ECSClient } from '@aws-sdk/client-ecs';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { IAMClient } from '@aws-sdk/client-iam';
import { KMSClient } from '@aws-sdk/client-kms';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { Route53Client } from '@aws-sdk/client-route-53';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SFNClient } from '@aws-sdk/client-sfn';
import { SSMClient } from '@aws-sdk/client-ssm';
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { createCredentialChain } from '@aws-sdk/credential-providers';
import { mockClient } from 'aws-sdk-client-mock';
import { TestIoHost } from './test-io-host';
import { SDK, SdkProvider } from '../../lib/api/aws-auth/private';
import { CloudFormationStack } from '../../lib/api/cloudformation';

export const FAKE_CREDENTIALS: SDKv3CompatibleCredentials = {
  accessKeyId: 'ACCESS',
  secretAccessKey: 'SECRET',
  sessionToken: 'TOKEN ',
};

export const FAKE_CREDENTIAL_CHAIN = createCredentialChain(() => Promise.resolve(FAKE_CREDENTIALS));

// Default implementations
export const awsMock = {
  appSync: mockClient(AppSyncClient),
  cloudControl: mockClient(CloudControlClient),
  cloudFormation: mockClient(CloudFormationClient),
  cloudWatch: mockClient(CloudWatchLogsClient),
  codeBuild: mockClient(CodeBuildClient),
  ec2: mockClient(EC2Client),
  ecr: mockClient(ECRClient),
  ecs: mockClient(ECSClient),
  elasticLoadBalancingV2: mockClient(ElasticLoadBalancingV2Client),
  iAM: mockClient(IAMClient),
  kMS: mockClient(KMSClient),
  lambda: mockClient(LambdaClient),
  route53: mockClient(Route53Client),
  s3: mockClient(S3Client),
  sSM: mockClient(SSMClient),
  sTS: mockClient(STSClient),
  secretsManager: mockClient(SecretsManagerClient),
  stepFunctions: mockClient(SFNClient),
};

// Global aliases for the mock clients for backwards compatibility
export const mockAppSyncClient = awsMock.appSync;
export const mockCloudControlClient = awsMock.cloudControl;
export const mockCloudFormationClient = awsMock.cloudFormation;
export const mockCloudWatchClient = awsMock.cloudWatch;
export const mockCodeBuildClient = awsMock.codeBuild;
export const mockEC2Client = awsMock.ec2;
export const mockECRClient = awsMock.ecr;
export const mockECSClient = awsMock.ecs;
export const mockElasticLoadBalancingV2Client = awsMock.elasticLoadBalancingV2;
export const mockIAMClient = awsMock.iAM;
export const mockKMSClient = awsMock.kMS;
export const mockLambdaClient = awsMock.lambda;
export const mockRoute53Client = awsMock.route53;
export const mockS3Client = awsMock.s3;
export const mockSSMClient = awsMock.sSM;
export const mockSTSClient = awsMock.sTS;
export const mockSecretsManagerClient = awsMock.secretsManager;
export const mockStepFunctionsClient = awsMock.stepFunctions;

/**
 * Resets clients back to defaults and resets the history
 * of usage of the mock.
 *
 * NOTE: This is distinct from the terminology of "restore" that is usually used
 * for Sinon/Jest mocks; "restore" usually means to discard the mock and restore the
 * original implementation. Instead, in this code base we mean "reset +
 * default".
 */
export const restoreSdkMocksToDefault = () => {
  applyToAllMocks('reset');

  for (const mock of Object.values(awsMock)) {
    (mock as any).onAnyCommand().resolves({});
  }
};

/**
 * Restore all SDK mocks to their real implementations
 *
 * This file will mock a bunch of SDK clients as soon as it is imported, and it's
 * not really possible to avoid importing it. To run any tests that need real clients
 * instead of fake ones, you need to run this function.
 *
 * This function would usually be called "restore" in Jest/Sinon terminology,
 * but "restore" was already being used with a different meaning in this file,
 * so I'm introducing the term "undo" as a synonym for "restore" in the context
 * of SDK mocks.
 */
export function undoAllSdkMocks() {
  applyToAllMocks('restore');
}

function applyToAllMocks(meth: 'reset' | 'restore') {
  for (const mock of Object.values(awsMock)) {
    mock[meth]();
  }
}

export const setDefaultSTSMocks = () => {
  mockSTSClient.on(GetCallerIdentityCommand).resolves({
    Account: '123456789012',
    Arn: 'aws:swa:123456789012:some-other-stuff',
  });
  mockSTSClient.on(AssumeRoleCommand).resolves({
    Credentials: {
      AccessKeyId: FAKE_CREDENTIALS.accessKeyId,
      SecretAccessKey: FAKE_CREDENTIALS.secretAccessKey,
      SessionToken: FAKE_CREDENTIALS.sessionToken,
      Expiration: new Date(Date.now() + 3600 * 1000),
    },
  });
};

/**
 * MockSdkProvider that is mostly SdkProvider but
 * with fake credentials and account information.
 *
 * For mocking the actual clients, the above mocking
 * clients may be used.
 */
export class MockSdkProvider extends SdkProvider {
  private defaultAccounts: string[] = [];

  constructor() {
    super(FAKE_CREDENTIAL_CHAIN, 'bermuda-triangle-1337', {
      ioHelper: new TestIoHost().asHelper('sdk'),
    });
  }

  public returnsDefaultAccounts(...accounts: string[]) {
    this.defaultAccounts = accounts;
  }

  public defaultAccount(): Promise<Account | undefined> {
    const accountId = this.defaultAccounts.length === 0
      ? '123456789012'
      : this.defaultAccounts.shift()!;
    return Promise.resolve({ accountId, partition: 'aws' });
  }
}

/**
 * MockSdk that is mostly just the SDK but with fake
 * credentials and a full set of default client mocks.
 * These individual functions within those clients can be
 * customized in the test file that uses it.
 */
export class MockSdk extends SDK {
  constructor() {
    super(FAKE_CREDENTIAL_CHAIN, 'bermuda-triangle-1337', {}, new TestIoHost().asHelper('sdk'));
  }

  public async currentAccount(): Promise<Account> {
    return {
      accountId: '123456789012',
      partition: 'aws',
    };
  }
}

export function mockBootstrapStack(stack?: Partial<Stack>) {
  return CloudFormationStack.fromStaticInformation(new MockSdk().cloudFormation(), 'CDKToolkit', {
    CreationTime: new Date(),
    StackName: 'CDKToolkit',
    StackStatus: StackStatus.CREATE_COMPLETE,
    ...stack,
    Outputs: [
      { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME' },
      { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT' },
      { OutputKey: 'ImageRepositoryName', OutputValue: 'REPO_NAME' },
      { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ...(stack?.Outputs ?? []),
    ],
  });
}

export function mockResolvedEnvironment(): Environment {
  return {
    account: '123456789',
    region: 'bermuda-triangle-1337',
    name: 'aws://123456789/bermuda-triangle-1337',
  };
}
