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

  test('destroy with concurrency', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.destroy(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      concurrency: 3,
    });

    // THEN
    expect(mockDestroyStack).toHaveBeenCalledTimes(2);
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

  test('skips the confirmation prompt when force is true', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.destroy(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      force: true,
    });

    // THEN
    expect(ioHost.requestSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      code: 'CDK_TOOLKIT_I7010',
    }));
    expect(mockDestroyStack).toHaveBeenCalledTimes(2);
  });

  test('warns when no stacks match the given name(s)', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.destroy(cx, {
      stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['DoesNotExist'] },
      force: true,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'destroy',
      level: 'warn',
      code: 'CDK_TOOLKIT_W7011',
      message: expect.stringContaining('No stacks match the name(s)'),
    }));
    expect(mockDestroyStack).not.toHaveBeenCalled();
  });

  test('suggests a closely matching stack when the name does not exist', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.destroy(cx, {
      stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['stack1'] },
      force: true,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'destroy',
      level: 'warn',
      code: 'CDK_TOOLKIT_W7010',
      message: expect.stringContaining('does not exist. Do you mean'),
    }));
    expect(mockDestroyStack).not.toHaveBeenCalled();
  });

  test('warns about a missing name but still destroys the matching stacks', async () => {
    // WHEN: one name matches (Stack1), the other does not
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.destroy(cx, {
      stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['Stack1', 'DoesNotExist'] },
      force: true,
    });

    // THEN: warn for the missing name, but no "no stacks match" and the match is destroyed
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      code: 'CDK_TOOLKIT_W7010',
      message: expect.stringContaining(`${chalk.red('DoesNotExist')} does not exist.`),
    }));
    expect(ioHost.notifySpy).not.toHaveBeenCalledWith(expect.objectContaining({
      code: 'CDK_TOOLKIT_W7011',
    }));
    expect(mockDestroyStack).toHaveBeenCalledTimes(1);
  });

  test('destroys all top-level stacks with the MAIN_ASSEMBLY strategy (cdk destroy --all)', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.destroy(cx, {
      stacks: { strategy: StackSelectionStrategy.MAIN_ASSEMBLY },
      force: true,
    });

    // THEN
    expect(mockDestroyStack).toHaveBeenCalledTimes(2);
  });

  test('destroys the single stack with the ONLY_SINGLE strategy (cdk destroy with no patterns)', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.destroy(cx, {
      stacks: { strategy: StackSelectionStrategy.ONLY_SINGLE },
      force: true,
    });

    // THEN
    expect(mockDestroyStack).toHaveBeenCalledTimes(1);
  });

  test('warns about every non-existent name when none of them match', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.destroy(cx, {
      stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['NopeA', 'NopeB'] },
      force: true,
    });

    // THEN: a per-name warning for each, plus the overall no-match warning
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CDK_TOOLKIT_W7010',
      message: expect.stringContaining(`${chalk.red('NopeA')} does not exist`),
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CDK_TOOLKIT_W7010',
      message: expect.stringContaining(`${chalk.red('NopeB')} does not exist`),
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CDK_TOOLKIT_W7011',
    }));
    expect(mockDestroyStack).not.toHaveBeenCalled();
  });

  describe('stacks nested in a stage', () => {
    test('destroys a stack inside a stage by its hierarchical id', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-stage');
      await toolkit.destroy(cx, {
        stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['Stage/StackInStage'] },
        force: true,
      });

      // THEN: only the staged stack is destroyed, not the top-level one
      expect(mockDestroyStack).toHaveBeenCalledTimes(1);
      expect(mockDestroyStack.mock.calls[0][0].stack.hierarchicalId).toEqual('Stage/StackInStage');
    });

    test('destroys a staged stack via a wildcard pattern', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-stage');
      await toolkit.destroy(cx, {
        stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['Stage/*'] },
        force: true,
      });

      // THEN
      expect(mockDestroyStack).toHaveBeenCalledTimes(1);
      expect(mockDestroyStack.mock.calls[0][0].stack.hierarchicalId).toEqual('Stage/StackInStage');
    });

    test('destroys a stack in a stage-only app (no top-level stacks)', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stage-only');
      await toolkit.destroy(cx, {
        stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['Stage/StackInStage'] },
        force: true,
      });

      // THEN
      expect(mockDestroyStack).toHaveBeenCalledTimes(1);
    });

    test('destroys a staged stack via wildcard in a stage-only app', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stage-only');
      await toolkit.destroy(cx, {
        stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['Stage/*'] },
        force: true,
      });

      // THEN
      expect(mockDestroyStack).toHaveBeenCalledTimes(1);
    });

    // Regression for the original revert: a stage-only app must not break the
    // warning path (the candidate lookup must see nested-stage stacks).
    test('warns without failing for a non-existent name in a stage-only app', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stage-only');
      await toolkit.destroy(cx, {
        stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['DoesNotExist/*'] },
        force: true,
      });

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'warn',
        code: 'CDK_TOOLKIT_W7011',
        message: expect.stringContaining('No stacks match the name(s)'),
      }));
      expect(mockDestroyStack).not.toHaveBeenCalled();
    });

    // Regression core: a close match nested inside a stage must be suggested,
    // which only works if the candidate lookup includes nested-stage stacks.
    test('suggests a nested-stage stack when only the casing differs', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stage-only');
      await toolkit.destroy(cx, {
        stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['stage/stackinstage'] },
        force: true,
      });

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'warn',
        code: 'CDK_TOOLKIT_W7010',
        message: expect.stringContaining(`does not exist. Do you mean ${chalk.blue('Stage/StackInStage')}?`),
      }));
      expect(mockDestroyStack).not.toHaveBeenCalled();
    });

    test('suggests a nested-stage stack for a wildcard pattern that differs only in case', async () => {
      // WHEN: a lower-cased wildcard that matches nothing but resembles the staged stack
      const cx = await builderFixture(toolkit, 'stage-only');
      await toolkit.destroy(cx, {
        stacks: { strategy: StackSelectionStrategy.PATTERN_MATCH, patterns: ['stage/*'] },
        force: true,
      });

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'warn',
        code: 'CDK_TOOLKIT_W7010',
        message: expect.stringContaining(`does not exist. Do you mean ${chalk.blue('Stage/StackInStage')}?`),
      }));
      expect(mockDestroyStack).not.toHaveBeenCalled();
    });
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
