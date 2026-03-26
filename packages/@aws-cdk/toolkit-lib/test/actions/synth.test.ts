import * as cdk from 'aws-cdk-lib';
import { Toolkit } from '../../lib/toolkit';
import { appFixture, autoCleanOutDir, builderFixture, disposableCloudAssemblySource, TestIoHost } from '../_helpers';
import { AssemblyBuilder, RWLock } from '../../lib/api';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
});

describe('synth', () => {
  test('synth from builder', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.synth(cx);

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'synth',
      level: 'result',
      message: expect.stringContaining('Successfully synthesized'),
    }));
  });

  test('emits stack counters', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.synth(cx);

    // Separate tests as colorizing hampers detection
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        counters: expect.objectContaining({
          assemblies: 1,
          stacks: 2,
        }),
      }),
    }));
  });

  test('synth from app', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'two-empty-stacks');
    await toolkit.synth(cx);

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'synth',
      level: 'result',
      message: expect.stringContaining('Successfully synthesized'),
    }));
  });

  test('single stack returns the stack', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.synth(cx);

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'synth',
      level: 'result',
      code: 'CDK_TOOLKIT_I1901',
      message: expect.stringContaining('Successfully synthesized'),
      data: expect.objectContaining({
        stacksCount: 1,
        stack: expect.objectContaining({
          hierarchicalId: 'Stack1',
          stackName: 'Stack1',
          stringifiedJson: expect.not.stringContaining('CheckBootstrapVersion'),
        }),
      }),
    }));
  });

  test('multiple stacks returns the ids', async () => {
    // WHEN
    await toolkit.synth(await appFixture(toolkit, 'two-empty-stacks'));

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'synth',
      level: 'result',
      code: 'CDK_TOOLKIT_I1902',
      message: expect.stringContaining('Successfully synthesized'),
      data: expect.objectContaining({
        stacksCount: 2,
        stackIds: ['Stack1', 'Stack2'],
      }),
    }));
  });

  test('output of synth can be used in other toolkit actions, but source is only disposed at the end', async () => {
    // GIVEN
    const [assemblySource, mockDispose, realDispose] = await disposableCloudAssemblySource(toolkit);
    const synthResult = await toolkit.synth(assemblySource);

    // WHEN
    await toolkit.list(synthResult);
    expect(mockDispose).not.toHaveBeenCalled();

    // WHEN
    await synthResult.dispose();
    expect(mockDispose).toHaveBeenCalled();
    await realDispose();
  });

  test('assembly is disposed when synth fails due to error annotations', async () => {
    // GIVEN
    await using synthDir = autoCleanOutDir();

    const builder: AssemblyBuilder = async (props) => {
      const app = new cdk.App({
        outdir: props.outdir,
        context: props.context,
      });
      const stack = new cdk.Stack(app, 'SomeStack');

      cdk.Annotations.of(stack).addError('Some error');

      return app.synth();
    };

    const cx = await toolkit.fromAssemblyBuilder(builder, {
      outdir: synthDir.dir,
    });

    // WHEN
    await expect(toolkit.synth(cx)).rejects.toThrow(/Found errors/);

    // There should not be a lock remaining in the given output directory
    const lock = new RWLock(synthDir.dir);
    expect(await lock._currentReaders()).toEqual([]);
    expect(await lock._currentWriter()).toEqual(undefined);
  });

  test('assembly is disposed when synth fails due to context lookup', async () => {
    // GIVEN
    await using synthDir = autoCleanOutDir();

    const builder: AssemblyBuilder = async (props) => {
      const app = new cdk.App({
        outdir: props.outdir,
        context: props.context,
      });
      const stack = new cdk.Stack(app, 'SomeStack');
      stack.reportMissingContextKey({
        key: 'some-key',
        provider: 'no-such-provider' as any,
        props: {
          account: '1234',
          region: 'asdf',
        },
      });

      return app.synth();
    };

    const cx = await toolkit.fromAssemblyBuilder(builder, {
      outdir: synthDir.dir,
    });

    // WHEN
    await expect(toolkit.synth(cx)).rejects.toThrow(/Unrecognized context provider name/);

    // There should not be a lock remaining in the given output directory
    const lock = new RWLock(synthDir.dir);
    expect(await lock._currentReaders()).toEqual([]);
    expect(await lock._currentWriter()).toEqual(undefined);
  });
});
