import {
  CreateChangeSetCommand,
  CreateStackCommand,
  DeleteStackCommand,
  ExecuteChangeSetCommand,
  GetTemplateCommand,
  StackStatus,
  UpdateTerminationProtectionCommand,
} from '@aws-sdk/client-cloudformation';
import { parse } from 'yaml';
import { Bootstrapper, legacyBootstrapTemplate } from '../../../lib/api/bootstrap';
import { deserializeStructure, serializeStructure, toYAML } from '../../../lib/util';
import { FakeCloudFormation } from '../../_helpers/fake-aws/fake-cloudformation';
import { advanceTime } from '../../_helpers/fake-time';
import { MockSdkProvider, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

const env = {
  account: '123456789012',
  region: 'us-east-1',
  name: 'mock',
};

const templateBody = toYAML(deserializeStructure(serializeStructure(legacyBootstrapTemplate({}), true)));
const changeSetName = 'cdk-deploy-change-set';

jest.mock('../../../lib/api/deployments/checks', () => ({
  determineAllowCrossAccountAssetPublishing: jest.fn().mockResolvedValue(true),
}));

let sdk: MockSdkProvider;
let bootstrapper: Bootstrapper;
let ioHost = new TestIoHost();
let ioHelper = ioHost.asHelper('bootstrap');
const fakeCfn = new FakeCloudFormation();

beforeEach(() => {
  jest.useFakeTimers();
  sdk = new MockSdkProvider();
  bootstrapper = new Bootstrapper({ source: 'legacy' }, ioHelper);
  fakeCfn.reset();
  restoreSdkMocksToDefault();
  fakeCfn.installUsingAwsMock(mockCloudFormationClient);
});

afterEach(() => {
  jest.useRealTimers();
});

/** Helper to bootstrap and advance fake timers */
function bootstrap(options?: Parameters<typeof bootstrapper.bootstrapEnvironment>[2]) {
  return advanceTime(bootstrapper.bootstrapEnvironment(env, sdk, options));
}

/** The template submitted to the most recent CreateChangeSet call */
function lastChangeSetTemplate() {
  return fakeCfn.firstStack().lastChangeSetTemplate;
}

test('do bootstrap', async () => {
  // WHEN
  const ret = await bootstrap({ toolkitStackName: 'mockStack' });

  // THEN
  const bucketProperties = lastChangeSetTemplate()!.Resources.StagingBucket.Properties;
  expect(bucketProperties.BucketName).toBeUndefined();
  expect(
    bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.KMSMasterKeyID,
  ).toBeUndefined();
  expect(lastChangeSetTemplate()!.Conditions.UsePublicAccessBlockConfiguration['Fn::Equals'][0]).toBe('true');
  expect(ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
});

test('do bootstrap using custom bucket name', async () => {
  // WHEN
  const ret = await bootstrap({
    toolkitStackName: 'mockStack',
    parameters: { bucketName: 'foobar' },
  });

  // THEN
  const bucketProperties = lastChangeSetTemplate()!.Resources.StagingBucket.Properties;
  expect(bucketProperties.BucketName).toBe('foobar');
  expect(
    bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.KMSMasterKeyID,
  ).toBeUndefined();
  expect(lastChangeSetTemplate()!.Conditions.UsePublicAccessBlockConfiguration['Fn::Equals'][0]).toBe('true');
  expect(ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
});

test('do bootstrap using KMS CMK', async () => {
  // WHEN
  const ret = await bootstrap({
    toolkitStackName: 'mockStack',
    parameters: { kmsKeyId: 'myKmsKey' },
  });

  // THEN
  const bucketProperties = lastChangeSetTemplate()!.Resources.StagingBucket.Properties;
  expect(bucketProperties.BucketName).toBeUndefined();
  expect(
    bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.KMSMasterKeyID,
  ).toBe('myKmsKey');
  expect(lastChangeSetTemplate()!.Conditions.UsePublicAccessBlockConfiguration['Fn::Equals'][0]).toBe('true');
  expect(ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
});

test('bootstrap disable bucket Public Access Block Configuration', async () => {
  // WHEN
  const ret = await bootstrap({
    toolkitStackName: 'mockStack',
    parameters: { publicAccessBlockConfiguration: false },
  });

  // THEN
  const bucketProperties = lastChangeSetTemplate()!.Resources.StagingBucket.Properties;
  expect(bucketProperties.BucketName).toBeUndefined();
  expect(
    bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.KMSMasterKeyID,
  ).toBeUndefined();
  expect(lastChangeSetTemplate()!.Conditions.UsePublicAccessBlockConfiguration['Fn::Equals'][0]).toBe('false');
  expect(ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
});

test('do bootstrap with custom tags for toolkit stack', async () => {
  // WHEN
  const ret = await bootstrap({
    toolkitStackName: 'mockStack',
    tags: [{ Key: 'Foo', Value: 'Bar' }],
  });

  // THEN
  const bucketProperties = lastChangeSetTemplate()!.Resources.StagingBucket.Properties;
  expect(bucketProperties.BucketName).toBeUndefined();
  expect(
    bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.KMSMasterKeyID,
  ).toBeUndefined();
  expect(lastChangeSetTemplate()!.Conditions.UsePublicAccessBlockConfiguration['Fn::Equals'][0]).toBe('true');
  expect(ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
});

test('passing trusted accounts to the old bootstrapping results in an error', async () => {
  await expect(
    bootstrap({
      toolkitStackName: 'mockStack',
      parameters: { trustedAccounts: ['0123456789012'] },
    }),
  ).rejects.toThrow('--trust can only be passed for the modern bootstrap experience.');
});

test('passing CFN execution policies to the old bootstrapping results in an error', async () => {
  await expect(
    bootstrap({
      toolkitStackName: 'mockStack',
      parameters: { cloudFormationExecutionPolicies: ['arn:aws:iam::aws:policy/AdministratorAccess'] },
    }),
  ).rejects.toThrow('--cloudformation-execution-policies can only be passed for the modern bootstrap experience.');
});

test('even if the bootstrap stack is in a rollback state, can still retry bootstrapping it', async () => {
  fakeCfn.createStackSync({
    StackName: 'MagicalStack',
    StackStatus: StackStatus.UPDATE_ROLLBACK_COMPLETE,
    Outputs: [
      { OutputKey: 'BucketName', OutputValue: 'bucket' },
      { OutputKey: 'BucketDomainName', OutputValue: 'aws.com' },
    ],
  });

  // WHEN
  const ret = await bootstrap({ toolkitStackName: 'MagicalStack' });

  // THEN
  const bucketProperties = lastChangeSetTemplate()!.Resources.StagingBucket.Properties;
  expect(bucketProperties.BucketName).toBeUndefined();
  expect(
    bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.KMSMasterKeyID,
  ).toBeUndefined();
  expect(ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetTemplateCommand, {
    StackName: 'MagicalStack',
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
});

test('even if the bootstrap stack failed to create, can still retry bootstrapping it', async () => {
  fakeCfn.createStackSync({
    StackName: 'MagicalStack',
    StackStatus: StackStatus.ROLLBACK_COMPLETE,
    Outputs: [{ OutputKey: 'BucketName', OutputValue: 'bucket' }],
  });

  // WHEN
  const ret = await bootstrap({ toolkitStackName: 'MagicalStack' });

  // THEN
  const bucketProperties = lastChangeSetTemplate()!.Resources.StagingBucket.Properties;
  expect(bucketProperties.BucketName).toBeUndefined();
  expect(
    bucketProperties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.KMSMasterKeyID,
  ).toBeUndefined();
  expect(ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(DeleteStackCommand, {
    StackName: 'MagicalStack',
  });
});

test('stack is not termination protected by default', async () => {
  // WHEN
  await bootstrap();

  // THEN
  // There are only two ways that termination can be set: either through calling CreateStackCommand
  // or by calling UpdateTerminationProtectionCommand, which is not done by default
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    StackName: 'CDKToolkit',
    ChangeSetType: 'CREATE',
    ClientToken: expect.any(String),
    Description: expect.any(String),
    Parameters: [],
    Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
    ChangeSetName: changeSetName,
    TemplateBody: templateBody,
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
  expect(mockCloudFormationClient).not.toHaveReceivedCommandWith(UpdateTerminationProtectionCommand, {
    EnableTerminationProtection: true,
    StackName: 'CDKToolkit',
  });
});

test('stack is termination protected when set', async () => {
  // WHEN
  await bootstrap({ terminationProtection: true });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
    ChangeSetName: changeSetName,
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(UpdateTerminationProtectionCommand, {
    EnableTerminationProtection: true,
    StackName: 'CDKToolkit',
  });
});

test('do showTemplate YAML', async () => {
  process.stdout.write = jest.fn().mockImplementationOnce((template) => {
    // THEN
    expect(parse(template)).toHaveProperty(
      'Description',
      'The CDK Toolkit Stack. It was created by `cdk bootstrap` and manages resources necessary for managing your Cloud Applications with AWS CDK.',
    );
  });

  // WHEN
  await bootstrapper.showTemplate(false);
});

test('do showTemplate JSON', async () => {
  process.stdout.write = jest.fn().mockImplementationOnce((template) => {
    // THEN
    expect(JSON.parse(template)).toHaveProperty(
      'Description',
      'The CDK Toolkit Stack. It was created by `cdk bootstrap` and manages resources necessary for managing your Cloud Applications with AWS CDK.',
    );
  });

  // WHEN
  await bootstrapper.showTemplate(true);
});

test('cleans up temporary directory after bootstrap', async () => {
  const fse = jest.requireActual('fs-extra');
  const mkdtempSpy = jest.spyOn(fse, 'mkdtemp');

  // WHEN
  await bootstrap({ toolkitStackName: 'mockStack' });

  // THEN
  const tempDir = await mkdtempSpy.mock.results[0].value;
  expect(fse.existsSync(tempDir)).toBe(false);

  mkdtempSpy.mockRestore();
});
