import * as path from 'node:path';
import { EnvironmentUtils } from '@aws-cdk/cloud-assembly-api';
import {
  CreateChangeSetCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { bold } from 'chalk';

import type { BootstrapOptions } from '../../lib/actions/bootstrap';
import { BootstrapEnvironments, BootstrapSource, BootstrapStackParameters, BootstrapTemplate } from '../../lib/actions/bootstrap';
import { SdkProvider } from '../../lib/api/aws-auth/private';
import { Toolkit } from '../../lib/toolkit/toolkit';
import { TestIoHost, builderFixture, disposableCloudAssemblySource } from '../_helpers';
import { FakeCloudFormation } from '../_helpers/fake-aws/fake-cloudformation';
import { advanceTime } from '../_helpers/fake-time';
import {
  MockSdk,
  mockCloudFormationClient,
  restoreSdkMocksToDefault,
  setDefaultSTSMocks,
} from '../_helpers/mock-sdk';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });
const fakeCfn = new FakeCloudFormation();

beforeEach(() => {
  jest.useFakeTimers();
  fakeCfn.reset();
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();
  ioHost.notifySpy.mockClear();
  fakeCfn.installUsingAwsMock(mockCloudFormationClient);

  jest.spyOn(SdkProvider.prototype, '_makeSdk').mockReturnValue(new MockSdk());
  jest.spyOn(SdkProvider.prototype, 'forEnvironment').mockResolvedValue({
    sdk: new MockSdk(),
    didAssumeRole: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

async function runBootstrap(options?: {
  environments?: string[];
  source?: BootstrapOptions['source'];
  parameters?: BootstrapStackParameters;
  forceDeployment?: boolean;
}) {
  const cx = await builderFixture(toolkit, 'stack-with-asset');
  const bootstrapEnvs = options?.environments?.length ?
    BootstrapEnvironments.fromList(options.environments) : BootstrapEnvironments.fromCloudAssemblySource(cx);
  return advanceTime(toolkit.bootstrap(bootstrapEnvs, {
    source: options?.source,
    parameters: options?.parameters,
    forceDeployment: options?.forceDeployment,
  }));
}

function expectValidBootstrapResult(result: any) {
  expect(result).toHaveProperty('environments');
  expect(Array.isArray(result.environments)).toBe(true);
}

function expectSuccessfulBootstrap() {
  expect(mockCloudFormationClient.calls().length).toBeGreaterThan(0);
  expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringContaining('bootstrapping...'),
  }));
  expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringContaining('✅'),
  }));
}

describe('bootstrap', () => {
  describe('with user-specified environments', () => {
    test('bootstraps specified environments', async () => {
      // WHEN — bootstrap each environment separately to avoid concurrent operations
      // on the same fake stack (the fake doesn't model regions)
      const result1 = await runBootstrap({ environments: ['aws://123456789012/us-east-1'] });
      const result2 = await runBootstrap({ environments: ['aws://234567890123/eu-west-1'] });

      // THEN
      expectValidBootstrapResult(result1);
      expectValidBootstrapResult(result2);

      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining(`${bold('aws://123456789012/us-east-1')}: bootstrapping...`),
      }));

      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining(`${bold('aws://234567890123/eu-west-1')}: bootstrapping...`),
      }));
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        code: 'CDK_TOOLKIT_I9900',
        message: expect.stringContaining('✅'),
        data: expect.objectContaining({
          environment: {
            name: 'aws://123456789012/us-east-1',
            account: '123456789012',
            region: 'us-east-1',
          },
        }),
      }));
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        code: 'CDK_TOOLKIT_I9900',
        message: expect.stringContaining('✅'),
        data: expect.objectContaining({
          environment: {
            name: 'aws://234567890123/eu-west-1',
            account: '234567890123',
            region: 'eu-west-1',
          },
        }),
      }));
    });

    test('handles errors in user-specified environments', async () => {
      // GIVEN
      const error = new Error('Access Denied');
      error.name = 'AccessDeniedException';
      mockCloudFormationClient
        .on(CreateChangeSetCommand)
        .rejects(error);

      // WHEN/THEN
      await expect(runBootstrap({ environments: ['aws://123456789012/us-east-1'] }))
        .rejects.toThrow('Access Denied');
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining(`${bold('aws://123456789012/us-east-1')} failed: Access Denied`),
      }));
    });

    test('throws error for invalid environment format', async () => {
      // WHEN/THEN
      await expect(runBootstrap({ environments: ['invalid-format'] }))
        .rejects.toThrow('Expected environment name in format \'aws://<account>/<region>\', got: invalid-format');
    });
  });

  describe('bootstrap parameters', () => {
    test('bootstrap with default parameters', async () => {
      // WHEN
      await runBootstrap();

      // THEN
      const createChangeSetCalls = mockCloudFormationClient.calls().filter(call => call.args[0] instanceof CreateChangeSetCommand);
      expect(createChangeSetCalls.length).toBeGreaterThan(0);
      const parameters = (createChangeSetCalls[0].args[0].input as any).Parameters;
      expect(new Set(parameters)).toEqual(new Set([
        { ParameterKey: 'TrustedAccounts', ParameterValue: '' },
        { ParameterKey: 'TrustedAccountsForLookup', ParameterValue: '' },
        { ParameterKey: 'CloudFormationExecutionPolicies', ParameterValue: '' },
        { ParameterKey: 'FileAssetsBucketKmsKeyId', ParameterValue: 'AWS_MANAGED_KEY' },
        { ParameterKey: 'PublicAccessBlockConfiguration', ParameterValue: 'true' },
      ]));
      expectSuccessfulBootstrap();
    });

    test('bootstrap with exact parameters', async () => {
      const customParams = {
        bucketName: 'custom-bucket',
        qualifier: 'test',
        publicAccessBlockConfiguration: false,
      };

      // WHEN
      await runBootstrap({
        parameters: BootstrapStackParameters.exactly(customParams),
      });

      // THEN
      const createChangeSetCalls = mockCloudFormationClient.calls().filter(call => call.args[0] instanceof CreateChangeSetCommand);
      expect(createChangeSetCalls.length).toBeGreaterThan(0);
      const parameters = (createChangeSetCalls[0].args[0].input as any).Parameters;
      expect(parameters).toContainEqual({ ParameterKey: 'FileAssetsBucketName', ParameterValue: 'custom-bucket' });
      expect(parameters).toContainEqual({ ParameterKey: 'Qualifier', ParameterValue: 'test' });
      expect(parameters).toContainEqual({ ParameterKey: 'PublicAccessBlockConfiguration', ParameterValue: 'false' });
      expectSuccessfulBootstrap();
    });

    test('bootstrap with additional parameters', async () => {
      const additionalParams = {
        qualifier: 'additional',
        trustedAccounts: ['123456789012'],
        cloudFormationExecutionPolicies: ['arn:aws:iam::aws:policy/AdministratorAccess'],
      };

      // WHEN
      await runBootstrap({
        parameters: BootstrapStackParameters.withExisting(additionalParams),
      });

      // THEN
      const createChangeSetCalls = mockCloudFormationClient.calls().filter(call => call.args[0] instanceof CreateChangeSetCommand);
      expect(createChangeSetCalls.length).toBeGreaterThan(0);
      const parameters = (createChangeSetCalls[0].args[0].input as any).Parameters;
      expect(parameters).toContainEqual({ ParameterKey: 'Qualifier', ParameterValue: 'additional' });
      expect(parameters).toContainEqual({ ParameterKey: 'TrustedAccounts', ParameterValue: '123456789012' });
      expect(parameters).toContainEqual({ ParameterKey: 'CloudFormationExecutionPolicies', ParameterValue: 'arn:aws:iam::aws:policy/AdministratorAccess' });
      expectSuccessfulBootstrap();
    });

    test('bootstrap with only existing parameters', async () => {
      // WHEN
      await runBootstrap({
        parameters: BootstrapStackParameters.onlyExisting(),
      });

      // THEN
      const createChangeSetCalls = mockCloudFormationClient.calls().filter(call => call.args[0] instanceof CreateChangeSetCommand);
      expect(createChangeSetCalls.length).toBeGreaterThan(0);
      const parameters = (createChangeSetCalls[0].args[0].input as any).Parameters;
      expect(new Set(parameters)).toEqual(new Set([
        { ParameterKey: 'TrustedAccounts', ParameterValue: '' },
        { ParameterKey: 'TrustedAccountsForLookup', ParameterValue: '' },
        { ParameterKey: 'CloudFormationExecutionPolicies', ParameterValue: '' },
        { ParameterKey: 'FileAssetsBucketKmsKeyId', ParameterValue: 'AWS_MANAGED_KEY' },
        { ParameterKey: 'PublicAccessBlockConfiguration', ParameterValue: 'true' },
      ]));
      expectSuccessfulBootstrap();
    });
  });

  describe('template sources', () => {
    test('uses default template when no source is specified', async () => {
      // WHEN
      await runBootstrap();

      // THEN
      expectSuccessfulBootstrap();
    });

    test('uses custom template when specified', async () => {
      // WHEN
      await runBootstrap({
        source: BootstrapSource.customTemplate(path.join(__dirname, '_fixtures', 'custom-bootstrap-template.yaml')),
      });

      // THEN
      const createChangeSetCalls = mockCloudFormationClient.calls().filter(call => call.args[0] instanceof CreateChangeSetCommand);
      expect(createChangeSetCalls.length).toBeGreaterThan(0);
      expectSuccessfulBootstrap();
    });

    test('handles errors with custom template', async () => {
      // GIVEN
      const templateError = new Error('Invalid template file');
      mockCloudFormationClient
        .on(DescribeStacksCommand)
        .rejects(templateError);

      // WHEN
      await expect(runBootstrap({
        source: BootstrapSource.customTemplate(path.join(__dirname, '_fixtures', 'invalid-bootstrap-template.yaml')),
      })).rejects.toThrow('Invalid template file');

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
    });
  });

  test('bootstrap handles no-op scenarios', async () => {
    // GIVEN — stack already exists with same template
    fakeCfn.createStackSync({
      StackName: 'CDKToolkit',
      StackStatus: 'CREATE_COMPLETE',
      Outputs: [
        { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME' },
        { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT' },
        { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ],
    });
    // Force the change set to report no changes
    fakeCfn.overrideChangeSetChanges = [];

    // WHEN
    await runBootstrap();

    // THEN
    expectSuccessfulBootstrap();
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('(no changes)'),
    }));
  });

  test('action disposes of assembly produced by source', async () => {
    const [assemblySource, mockDispose, realDispose] = await disposableCloudAssemblySource(toolkit);

    // WHEN
    await advanceTime(toolkit.bootstrap(BootstrapEnvironments.fromCloudAssemblySource(assemblySource), { }));

    // THEN
    expect(mockDispose).toHaveBeenCalled();
    await realDispose();
  });

  describe('forceDeployment option', () => {
    test('accepts forceDeployment option in BootstrapOptions', async () => {
      const cx = await builderFixture(toolkit, 'stack-with-asset');
      const bootstrapEnvs = BootstrapEnvironments.fromCloudAssemblySource(cx);

      // WHEN
      const result = await advanceTime(toolkit.bootstrap(bootstrapEnvs, {
        forceDeployment: true,
      }));

      // THEN
      expectValidBootstrapResult(result);
      expectSuccessfulBootstrap();
    });
  });

  describe('error handling', () => {
    test('returns correct BootstrapResult for successful bootstraps', async () => {
      // WHEN
      const result = await runBootstrap({ environments: ['aws://123456789012/us-east-1'] });

      // THEN
      expectValidBootstrapResult(result);
      expect(result.environments.length).toBe(1);
      expect(result.environments[0].status).toBe('success');
      expect(result.environments[0].environment).toStrictEqual(EnvironmentUtils.make('123456789012', 'us-east-1'));
      expect(result.environments[0].duration).toBeGreaterThan(0);
    });

    test('returns correct BootstrapResult for no-op scenarios', async () => {
      // GIVEN — stack already exists
      fakeCfn.createStackSync({
        StackName: 'CDKToolkit',
        StackStatus: 'CREATE_COMPLETE',
        Outputs: [
          { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME' },
          { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT' },
          { OutputKey: 'BootstrapVersion', OutputValue: '1' },
        ],
      });
      fakeCfn.overrideChangeSetChanges = [];

      // WHEN
      const result = await runBootstrap({ environments: ['aws://123456789012/us-east-1'] });

      // THEN
      expectValidBootstrapResult(result);
      expect(result.environments.length).toBe(1);
      expect(result.environments[0].status).toBe('no-op');
      expect(result.environments[0].environment).toStrictEqual(EnvironmentUtils.make('123456789012', 'us-east-1'));
      expect(result.environments[0].duration).toBeGreaterThan(0);
    });

    test('returns correct BootstrapResult for failure', async () => {
      // GIVEN
      const error = new Error('Access Denied');
      error.name = 'AccessDeniedException';
      mockCloudFormationClient
        .on(DescribeStacksCommand)
        .rejects(error);

      // WHEN/THEN
      await expect(runBootstrap({ environments: ['aws://123456789012/us-east-1'] }))
        .rejects.toThrow('Access Denied');
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
    });

    test('handles generic bootstrap errors', async () => {
      // GIVEN
      const error = new Error('Bootstrap failed');
      mockCloudFormationClient
        .on(DescribeStacksCommand)
        .rejects(error);

      // WHEN/THEN
      await expect(runBootstrap({ environments: ['aws://123456789012/us-east-1'] }))
        .rejects.toThrow('Bootstrap failed');
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
    });

    test('handles permission errors', async () => {
      // GIVEN
      const error = new Error('Access Denied');
      error.name = 'AccessDeniedException';
      mockCloudFormationClient
        .on(DescribeStacksCommand)
        .rejects(error);

      // WHEN/THEN
      await expect(runBootstrap({ environments: ['aws://123456789012/us-east-1'] }))
        .rejects.toThrow('Access Denied');
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
    });
  });

  describe('BootstrapTemplate.fromSource', () => {
    test('can retrieve default bootstrap template as YAML', async () => {
      const bootstrapTemplate = await BootstrapTemplate.fromSource();
      const template = bootstrapTemplate.asYAML();
      expect(template).toContain('Description:');
      expect(template).toContain('Parameters:');
      expect(template).toContain('Resources:');
      expect(template).toContain('StagingBucket:');
      expect(() => JSON.parse(template)).toThrow();
    });

    test('can retrieve default bootstrap template as JSON', async () => {
      const bootstrapTemplate = await BootstrapTemplate.fromSource();
      const template = bootstrapTemplate.asJSON();
      const parsed = JSON.parse(template);
      expect(parsed.Description).toBeDefined();
      expect(parsed.Parameters).toBeDefined();
      expect(parsed.Resources).toBeDefined();
      expect(parsed.Resources.StagingBucket).toBeDefined();
    });

    test('can retrieve custom bootstrap template', async () => {
      const customTemplatePath = path.join(__dirname, '_fixtures/custom-bootstrap-template.yaml');
      const bootstrapTemplate = await BootstrapTemplate.fromSource(
        BootstrapSource.customTemplate(customTemplatePath),
      );
      const template = bootstrapTemplate.asYAML();
      expect(template).toContain('Description: Custom CDK Bootstrap Template');
    });
  });
});
