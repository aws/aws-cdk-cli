import * as path from 'node:path';
import {
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  Stack,
} from '@aws-sdk/client-cloudformation';
import { bold } from 'chalk';
import { BootstrapSource } from '../../lib/actions/bootstrap';
import { SdkProvider } from '../../lib/api/aws-cdk';
import { BootstrapEnvironments, Toolkit } from '../../lib/toolkit';
import { TestIoHost, builderFixture } from '../_helpers';
import {
  MockSdkProvider,
  MockSdk,
  mockCloudFormationClient,
  restoreSdkMocksToDefault,
  setDefaultSTSMocks,
  rootDir,
} from '../util/aws-cdk';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });
const mockSdkProvider = new MockSdkProvider();

// we don't need to use AWS CLI compatible defaults here, since everything is mocked anyway
jest.spyOn(SdkProvider, 'withAwsCliCompatibleDefaults').mockResolvedValue(mockSdkProvider);

beforeEach(() => {
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();
  ioHost.notifySpy.mockClear();
});

afterEach(() => {
  jest.resetAllMocks();
});

function setupMockCloudFormationClient(mockStack: Stack) {
  mockCloudFormationClient
    .on(DescribeStacksCommand)
    .resolves({ Stacks: [] }) // First call - stack doesn't exist
    .on(CreateChangeSetCommand)
    .resolves({ Id: 'CHANGESET_ID' })
    .on(DescribeChangeSetCommand)
    .resolves({
      Status: 'CREATE_COMPLETE',
      Changes: [{ ResourceChange: { Action: 'Add' } }],
      ExecutionStatus: 'AVAILABLE',
    })
    .on(ExecuteChangeSetCommand)
    .resolves({})
    .on(DescribeStacksCommand)
    .resolves({ // Stack is in progress
      Stacks: [{
        ...mockStack,
        StackStatus: 'CREATE_IN_PROGRESS',
      }],
    })
    .on(DescribeStacksCommand)
    .resolves({ // Final state - stack is complete
      Stacks: [{
        ...mockStack,
        StackStatus: 'CREATE_COMPLETE',
      }],
    });
}

function createMockStack(outputs: { OutputKey: string; OutputValue: string }[]): Stack {
  return {
    StackId: 'mock-stack-id',
    StackName: 'CDKToolkit',
    CreationTime: new Date(),
    LastUpdatedTime: new Date(),
    Outputs: outputs,
  } as Stack;
}

async function runBootstrap(options?: { environments?: string[]; source?: BootstrapSource }) {
  const cx = await builderFixture(toolkit, 'stack-with-asset');
  const bootstrapEnvs = options?.environments?.length ?
    BootstrapEnvironments.fromList(options.environments) : BootstrapEnvironments.fromCloudAssemblySource(cx);
  return toolkit.bootstrap(bootstrapEnvs, { source: options?.source });
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
    let originalSdk = mockSdkProvider.forEnvironment;
    beforeEach(() => {
      const mockForEnvironment = jest.fn().mockImplementation(() => {
        return { sdk: new MockSdk() };
      });
      mockSdkProvider.forEnvironment = mockForEnvironment;
    });

    afterAll(() => {
      mockSdkProvider.forEnvironment = originalSdk;
    });

    test('bootstraps specified environments', async () => {
      // GIVEN
      const mockStack1 = createMockStack([
        { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME_1' },
        { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT_1' },
        { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ]);
      const mockStack2 = createMockStack([
        { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME_2' },
        { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT_2' },
        { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ]);
      setupMockCloudFormationClient(mockStack1);
      setupMockCloudFormationClient(mockStack2);

      // WHEN
      await runBootstrap({ environments: ['aws://123456789012/us-east-1', 'aws://210987654321/eu-west-1'] });

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining(`${bold('aws://123456789012/us-east-1')}: bootstrapping...`),
      }));

      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining(`${bold('aws://210987654321/eu-west-1')}: bootstrapping...`),
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
            name: 'aws://210987654321/eu-west-1',
            account: '210987654321',
            region: 'eu-west-1',
          },
        }),
      }));
    });

    test('handles errors in user-specified environments', async () => {
      // GIVEN
      const mockStack = createMockStack([
        { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME' },
        { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT' },
        { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ]);
      setupMockCloudFormationClient(mockStack);

      // Mock an access denied error
      const accessDeniedError = new Error('Access Denied');
      accessDeniedError.name = 'AccessDeniedException';
      mockCloudFormationClient
        .on(CreateChangeSetCommand)
        .rejects(accessDeniedError);

      // WHEN/THEN
      await expect(runBootstrap({ environments: ['aws://123456789012/us-east-1'] }))
        .rejects.toThrow('Access Denied');

      // Get all error notifications
      const errorCalls = ioHost.notifySpy.mock.calls
        .filter(call => call[0].level === 'error')
        .map(call => call[0]);

      // Verify error notifications
      expect(errorCalls).toContainEqual(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
      expect(errorCalls).toContainEqual(expect.objectContaining({
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

  describe('template sources', () => {
    test('uses default template when no source is specified', async () => {
      // GIVEN
      const mockStack = createMockStack([
        { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME' },
        { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT' },
        { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ]);
      setupMockCloudFormationClient(mockStack);

      // WHEN
      await runBootstrap();

      // THEN
      expectSuccessfulBootstrap();
    });

    test('uses custom template when specified', async () => {
      // GIVEN
      const mockStack = createMockStack([
        { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME' },
        { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT' },
        { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ]);
      setupMockCloudFormationClient(mockStack);

      // WHEN
      await runBootstrap({
        source: BootstrapSource.customTemplate(path.join(rootDir(), 'lib', 'api', 'bootstrap', 'bootstrap-template.yaml')),
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
        source: BootstrapSource.customTemplate(path.join(rootDir(), 'lib', 'api', 'bootstrap', 'bootstrap-template.yaml')),
      })).rejects.toThrow('Invalid template file');

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
    });
  });

  test('bootstrap handles no-op scenarios', async () => {
    // GIVEN
    const mockExistingStack = {
      StackId: 'mock-stack-id',
      StackName: 'CDKToolkit',
      StackStatus: 'CREATE_COMPLETE',
      CreationTime: new Date(),
      LastUpdatedTime: new Date(),
      Outputs: [
        { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME' },
        { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT' },
        { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ],
    } as Stack;

    // First describe call to check if stack exists
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolves({ Stacks: [mockExistingStack] });

    // Create changeset call
    mockCloudFormationClient
      .on(CreateChangeSetCommand)
      .resolves({ Id: 'CHANGESET_ID', StackId: mockExistingStack.StackId });

    // Describe changeset call - indicate no changes
    mockCloudFormationClient
      .on(DescribeChangeSetCommand)
      .resolves({
        Status: 'FAILED',
        StatusReason: 'No updates are to be performed.',
        Changes: [],
        ExecutionStatus: 'UNAVAILABLE',
        StackId: mockExistingStack.StackId,
        ChangeSetId: 'CHANGESET_ID',
      });

    // Delete changeset call after no changes detected
    mockCloudFormationClient
      .on(DeleteChangeSetCommand)
      .resolves({});

    // Final describe call to get outputs
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolves({ Stacks: [mockExistingStack] });

    // WHEN
    await runBootstrap();

    // THEN
    expectSuccessfulBootstrap();
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('(no changes)'),
    }));
  });

  describe('error handling', () => {
    test('handles generic bootstrap errors', async () => {
      // GIVEN
      mockCloudFormationClient.onAnyCommand().rejects(new Error('Bootstrap failed'));

      // WHEN
      await expect(runBootstrap()).rejects.toThrow('Bootstrap failed');

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
    });

    test('handles permission errors', async () => {
      // GIVEN
      const permissionError = new Error('Access Denied');
      permissionError.name = 'AccessDeniedException';
      mockCloudFormationClient.onAnyCommand().rejects(permissionError);

      // WHEN
      await expect(runBootstrap()).rejects.toThrow('Access Denied');

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('❌'),
      }));
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('Access Denied'),
      }));
    });
  });
});
