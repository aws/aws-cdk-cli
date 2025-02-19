import {
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  Stack,
} from '@aws-sdk/client-cloudformation';
import { Toolkit } from '../../lib/toolkit';
import { TestIoHost, builderFixture } from '../_helpers';
import {
  MockSdkProvider,
  SdkProvider,
  mockCloudFormationClient,
  restoreSdkMocksToDefault,
  setDefaultSTSMocks,
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

describe('bootstrap', () => {
  test('bootstrap creates a new stack if it does not exist', async () => {
    // GIVEN
    const mockStack = {
      StackId: 'mock-stack-id',
      StackName: 'CDKToolkit',
      CreationTime: new Date(),
      LastUpdatedTime: new Date(),
      Outputs: [
        { OutputKey: 'BucketName', OutputValue: 'BUCKET_NAME' },
        { OutputKey: 'BucketDomainName', OutputValue: 'BUCKET_ENDPOINT' },
        { OutputKey: 'BootstrapVersion', OutputValue: '1' },
      ],
    } as Stack;

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

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-asset');
    await toolkit.bootstrap(cx);

    // THEN
    expect(mockCloudFormationClient.calls().length).toBeGreaterThan(0);
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('bootstrapping...'),
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✅'),
    }));
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
    const cx = await builderFixture(toolkit, 'stack-with-asset');
    await toolkit.bootstrap(cx);

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✅'),
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('(no changes)'),
    }));
  });

  describe('error handling', () => {
    test('handles generic bootstrap errors', async () => {
      // GIVEN
      mockCloudFormationClient.onAnyCommand().rejects(new Error('Bootstrap failed'));

      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-asset');
      await expect(toolkit.bootstrap(cx)).rejects.toThrow('Bootstrap failed');

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
      const cx = await builderFixture(toolkit, 'stack-with-asset');
      await expect(toolkit.bootstrap(cx)).rejects.toThrow('Access Denied');

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
