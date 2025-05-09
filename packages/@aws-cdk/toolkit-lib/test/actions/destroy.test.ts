import * as chalk from 'chalk';
import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import * as deployments from '../../lib/api/deployments';
import type { DestroyStackOptions } from '../../lib/api/deployments';
import type { RollbackResult } from '../../lib/toolkit';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, disposableCloudAssemblySource, TestIoHost } from '../_helpers';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });
jest.spyOn(toolkit, 'rollback').mockResolvedValue({ stacks: [] } satisfies RollbackResult);

let mockDestroyStack: jest.SpyInstance<Promise<any>, [DestroyStackOptions]>;

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
  jest.clearAllMocks();

  mockDestroyStack = jest.spyOn(deployments.Deployments.prototype, 'destroyStack').mockResolvedValue({});
});

describe('destroy', () => {
  test('destroy from builder', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.destroy(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    successfulDestroy();
  });

  test('request response before destroying', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.destroy(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    expect(ioHost.requestSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'destroy',
      level: 'info',
      code: 'CDK_TOOLKIT_I7010',
      message: expect.stringContaining('Are you sure you want to delete'),
    }));
  });

  test('multiple stacks', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.destroy(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'destroy',
      level: 'result',
      message: expect.stringContaining(`${chalk.blue('Stack2')}${chalk.green(': destroyed')}`),
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'destroy',
      level: 'result',
      message: expect.stringContaining(`${chalk.blue('Stack1')}${chalk.green(': destroyed')}`),
    }));
  });

  test('destroy deployment fails', async () => {
    // GIVEN
    mockDestroyStack.mockRejectedValue({});

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    try {
      await toolkit.destroy(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });
    } catch (e) {
      // We know this will error, ignore it
    }

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'destroy',
      level: 'error',
      message: expect.stringContaining('destroy failed'),
    }));
  });

  test('action disposes of assembly produced by source', async () => {
    // GIVEN
    const [assemblySource, mockDispose, realDispose] = await disposableCloudAssemblySource(toolkit);

    // WHEN
    await toolkit.destroy(assemblySource, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(mockDispose).toHaveBeenCalled();
    await realDispose();
  });
});

function successfulDestroy() {
  expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
    action: 'destroy',
    level: 'result',
    code: 'CDK_TOOLKIT_I7900',
    message: expect.stringContaining('destroyed'),
    data: expect.objectContaining({
      displayName: expect.any(String),
    }),
  }));
}
