import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import * as deployments from '../../lib/api/deployments';
import type { RollbackStackOptions, RollbackStackResult } from '../../lib/api/deployments';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, disposableCloudAssemblySource, TestIoHost } from '../_helpers';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });

let mockRollbackStack: jest.SpyInstance<Promise<RollbackStackResult>, [RollbackStackOptions]>;

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
  jest.clearAllMocks();

  mockRollbackStack = jest.spyOn(deployments.Deployments.prototype, 'rollbackStack').mockResolvedValue({
    success: true,
    stackArn: 'arn:stack',
  });
});

describe('rollback', () => {
  test('successful rollback', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    const result = await toolkit.rollback(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    successfulRollback();

    expect(result).toEqual({
      stacks: [
        {
          environment: {
            account: 'unknown-account',
            region: 'unknown-region',
          },
          result: 'rolled-back',
          stackArn: 'arn:stack',
          stackName: 'Stack1',
        },
        {
          environment: {
            account: 'unknown-account',
            region: 'unknown-region',
          },
          result: 'rolled-back',
          stackArn: 'arn:stack',
          stackName: 'Stack2',
        },
      ],
    });
  });

  test('rollback not in rollbackable state', async () => {
    // GIVEN
    mockRollbackStack.mockResolvedValue({
      notInRollbackableState: true,
      stackArn: 'arn:stack',
    });

    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await expect(async () => toolkit.rollback(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    })).rejects.toThrow(/No stacks were in a state that could be rolled back/);
  });

  test('rollback not in rollbackable state', async () => {
    // GIVEN
    mockRollbackStack.mockRejectedValue({});

    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await expect(async () => toolkit.rollback(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    })).rejects.toThrow(/Rollback failed/);
  });

  test('action disposes of assembly produced by source', async () => {
    // GIVEN
    const [assemblySource, mockDispose, realDispose] = await disposableCloudAssemblySource(toolkit);

    // WHEN
    await toolkit.rollback(assemblySource, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(mockDispose).toHaveBeenCalled();
    await realDispose();
  });
});

function successfulRollback() {
  expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
    action: 'rollback',
    level: 'info',
    message: expect.stringContaining('Rollback time:'),
  }));
}
