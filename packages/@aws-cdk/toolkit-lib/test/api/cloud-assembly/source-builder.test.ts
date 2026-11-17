import * as os from 'os';
import * as path from 'path';
import { App } from 'aws-cdk-lib/core';
import * as fs from 'fs-extra';
import { MemoryContext } from '../../../lib';
import * as environment from '../../../lib/api/cloud-assembly/environment';
import { RWLock } from '../../../lib/api/rwlock';
import * as contextproviders from '../../../lib/context-providers';
import { Toolkit } from '../../../lib/toolkit/toolkit';
import { ToolkitError } from '../../../lib/toolkit/toolkit-error';
import { appFixture, appFixtureConfig, autoCleanOutDir, builderFixture, builderFunctionFromFixture, cdkOutFixture, TestIoHost } from '../../_helpers';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
});

describe('fromAssemblyBuilder', () => {
  test('defaults', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await using result = await cx.produce();
    const assembly = result.cloudAssembly;

    // THEN
    expect(assembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);
  });

  test('can provide context', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'external-context', {
      'externally-provided-bucket-name': 'amzn-s3-demo-bucket',
    });
    await using assembly = await cx.produce();
    const stack = assembly.cloudAssembly.getStackByName('Stack1').template;

    // THEN
    expect(JSON.stringify(stack)).toContain('amzn-s3-demo-bucket');
  });

  test('can pass context automatically', async () => {
    return toolkit.fromAssemblyBuilder(async () => {
      const app = new App();

      // Make sure the context makes it to the app
      expect(app.node.tryGetContext('external-context')).toEqual('yes');

      return app.synth();
    }, {
      contextStore: new MemoryContext({
        'external-context': 'yes',
      }),
    });
  });

  test('can avoid setting environment variables', async () => {
    return toolkit.fromAssemblyBuilder(async (props) => {
      const app = new App({
        outdir: props.outdir,
        context: props.context,
      });

      // Make sure the context makes it to the app
      expect(app.node.tryGetContext('external-context')).toEqual('yes');

      expect(process.env.CDK_CONTEXT).toBeUndefined();
      expect(props.env.CDK_CONTEXT).toBeDefined();

      return app.synth();
    }, {
      contextStore: new MemoryContext({
        'external-context': 'yes',
      }),
      clobberEnv: false,
    });
  });

  test.each(['sync', 'async'] as const)('errors are wrapped as AssemblyError for %s builder', async (sync) => {
    // GIVEN
    const builder = sync === 'sync'
      ? () => {
        throw new Error('a wild error appeared');
      }
      : async () => {
        throw new Error('a wild error appeared');
      };

    const cx = await toolkit.fromAssemblyBuilder(builder);

    // WHEN
    try {
      await cx.produce();
    } catch (err: any) {
      // THEN
      expect(ToolkitError.isAssemblyError(err)).toBe(true);
      expect(err.cause?.message).toContain('a wild error appeared');
    }
  });

  test('disposeOutdir can be used to disappear explicit synth dir', async () => {
    // GIVEN
    await using synthDir = autoCleanOutDir();
    const builder = builderFunctionFromFixture('two-empty-stacks');

    // WHEN
    const cx = await toolkit.fromAssemblyBuilder(builder, {
      outdir: path.join(synthDir.dir, 'relative.dir'),
      disposeOutdir: true,
    });

    const asm = await toolkit.synth(cx);

    expect(await fs.pathExists(asm.cloudAssembly.directory)).toBeTruthy();
    await asm.dispose();

    // THEN
    expect(await fs.pathExists(asm.cloudAssembly.directory)).toBeFalsy();
  });

  test('fromAssemblyBuilder can successfully loop', async () => {
    // GIVEN
    const provideContextValues = jest.spyOn(contextproviders, 'provideContextValues').mockImplementation(async (
      missingValues,
      _sdk,
      _ioHelper,
    ) => {
      return Object.fromEntries(missingValues.map(missing => [missing.key, 'provided']));
    });

    const cx = await appFixture(toolkit, 'uses-context-provider');

    // WHEN
    await using _ = await cx.produce();

    // THEN - no exception

    provideContextValues.mockRestore();
  });

  test('builder directory is locked, and builder failure cleans up the lock', async () => {
    let lock: RWLock;

    // GIVEN
    const cx = await toolkit.fromAssemblyBuilder(async (props) => {
      lock = new RWLock(props.outdir!);
      if (!await (lock as any)._currentWriter()) {
        throw new Error('Expected the directory to be locked during synth');
      }
      throw new Error('a wild error appeared');
    });

    // WHEN
    await expect(cx.produce()).rejects.toThrow();

    // THEN: Don't expect either a read or write lock on the directory afterwards
    expect(await (lock! as any)._currentWriter()).toBeUndefined();
    expect(await (lock! as any)._currentReaders()).toEqual([]);
  });

  describe('resolveDefaultEnvironment', () => {
    let prepareDefaultEnvironmentSpy: jest.SpyInstance;
    beforeEach(() => {
      // Mock the prepareDefaultEnvironment function to avoid actual STS calls
      prepareDefaultEnvironmentSpy = jest.spyOn(environment, 'prepareDefaultEnvironment')
        .mockImplementation(async () => {
          return {
            CDK_DEFAULT_ACCOUNT: '123456789012',
            CDK_DEFAULT_REGION: 'us-east-1',
          };
        });
    });

    afterEach(() => {
      prepareDefaultEnvironmentSpy.mockRestore();
    });

    test.each([[true, 1], [false, 0], [undefined, 1]])('respects resolveDefaultEnvironment=%s', async (resolveDefaultEnvironment, callCount) => {
      // WHEN
      const cx = await toolkit.fromAssemblyBuilder(async () => {
        const app = new App();
        return app.synth();
      }, {
        resolveDefaultEnvironment,
      });

      await using _ = await cx.produce();

      // THEN
      expect(prepareDefaultEnvironmentSpy).toHaveBeenCalledTimes(callCount);
    });
  });

  describe('abort', () => {
    /**
     * Unlike a CDK app in a subprocess, a builder runs in-process and cannot be
     * killed from outside. So respecting the signal is the builder's job, and
     * `fromAssemblyBuilder` only guarantees the outcome: once the signal has
     * fired, `produce()` fails even if the builder itself reported success.
     */
    test('a builder that ignores the abort and returns normally still fails with an exception', async () => {
      const controller = new AbortController();
      controller.abort();
      const cx = await toolkit.fromAssemblyBuilder(async () => new App().synth());

      // WHEN / THEN - the builder succeeded, the production did not
      await expect(cx.produce({ abort: controller.signal })).rejects.toThrow(/This operation was aborted/);
    });

    test('the builder is handed the signal so it stop when necessary', async () => {
      // The recommended pattern is checking `abort?.aborted` inside long loops;
      // that is only possible if the signal actually reaches the builder.
      const signal = AbortSignal.timeout(100000000);
      let seen;
      const cx = await toolkit.fromAssemblyBuilder(async (props) => {
        seen = props.abort;
        return new App().synth();
      });

      await cx.produce({ abort: signal });
      expect(seen).toEqual(signal);
    });

    test("a builder's own failure is still reported as a builder failure when aborted", async () => {
      // An abort must not mask a real error in the user's code: the cause is
      // what tells them what to fix.
      const controller = new AbortController();
      const cx = await toolkit.fromAssemblyBuilder(async () => {
        controller.abort();
        throw new Error('a wild error appeared');
      });

      const error = await cx.produce({ abort: controller.signal }).catch((e) => e);

      expect(ToolkitError.isAssemblyError(error)).toBe(true);
      expect(error.cause?.message).toContain('a wild error appeared');
    });

    test('an un-aborted signal leaves a normal build alone', async () => {
      const cx = await builderFixture(toolkit, 'two-empty-stacks');

      await using result = await cx.produce({ abort: new AbortController().signal });

      expect(result.cloudAssembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);
    });
  });
});

describe('fromCdkApp', () => {
  test('applies the default synth settings', async () => {
    // The settings a CDK app receives when the caller says nothing: `fromCdkApp`
    // fills in the defaults, unlike `fromCdkAppDirectory` where `cdk.json` decides.
    using dir = cdkAppDirectory({});
    const cx = await toolkit.fromCdkApp('node app.js', {
      workingDirectory: dir.dir,
      outdir: path.join(dir.dir, 'cdk.out'),
      contextStore: new MemoryContext(),
    });

    await using result = await cx.produce();

    expect(synthInput(result.cloudAssembly.directory).context).toMatchObject({
      'aws:cdk:enable-path-metadata': true,
      'aws:cdk:enable-asset-metadata': true,
      'aws:cdk:version-reporting': true,
      'aws:cdk:bundling-stacks': ['**'],
    });
  });

  test('creates an output directory that does not exist yet', async () => {
    // The mkdir lives in `ExecutionEnvironment.create`; a missing parent must not fail synth.
    using dir = cdkAppDirectory({});
    const outdir = path.join(dir.dir, 'does', 'not', 'exist', 'yet');
    const cx = await toolkit.fromCdkApp('node app.js', {
      workingDirectory: dir.dir,
      outdir,
      contextStore: new MemoryContext(),
    });

    await using result = await cx.produce();

    expect(result.cloudAssembly.directory).toEqual(outdir);
  });

  test('defaults', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'two-empty-stacks');
    await using assembly = await cx.produce();

    // THEN
    expect(assembly.cloudAssembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);
  });

  test('synth succeeds when working directory is given and outdir is relative', async () => {
    // GIVEN
    await using synthDir = autoCleanOutDir();
    const oldWorking = process.cwd();
    process.chdir(synthDir.dir);
    try {
      // WHEN
      const app = await appFixtureConfig('two-empty-stacks');
      const cx = await toolkit.fromCdkApp(app.app, {
        workingDirectory: app.workingDirectory,
        outdir: 'relative.dir',
        disposeOutdir: true,
      });

      await using assembly = await cx.produce();

      // THEN - synth succeeds
      expect(assembly.cloudAssembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);

      // asm directory is relative to the dir containing the app
      expect(assembly.cloudAssembly.directory.startsWith(app.workingDirectory));
    } finally {
      process.chdir(oldWorking);
    }
  });

  test('disposeOutdir can be used to disappear explicit synth dir', async () => {
    // GIVEN
    await using synthDir = autoCleanOutDir();
    const app = await appFixtureConfig('two-empty-stacks');

    // WHEN
    const cx = await toolkit.fromCdkApp(app.app, {
      workingDirectory: app.workingDirectory,
      outdir: path.join(synthDir.dir, 'relative.dir'),
      disposeOutdir: true,
    });

    const asm = await toolkit.synth(cx);

    expect(await fs.pathExists(asm.cloudAssembly.directory)).toBeTruthy();
    await asm.dispose();

    // THEN
    expect(await fs.pathExists(asm.cloudAssembly.directory)).toBeFalsy();
  });

  test('can provide context', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'external-context', {
      contextStore: new MemoryContext({
        'externally-provided-bucket-name': 'amzn-s3-demo-bucket',
      }),
    });
    await using assembly = await cx.produce();
    const stack = assembly.cloudAssembly.getStackByName('Stack1').template;

    // THEN
    expect(JSON.stringify(stack)).toContain('amzn-s3-demo-bucket');
  });

  test('can set environment variables', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'environment-variable', {
      env: {
        STACK_NAME: 'SomeStackName',
      },
    });
    await using assembly = await cx.produce();
    const stack = assembly.cloudAssembly.getStackByName('SomeStackName').template;

    // THEN
    expect(stack).toBeDefined();
  });

  test('will capture error output', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'validation-error');
    try {
      await cx.produce();
    } catch {
      // we are just interested in the output for this test
    }

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      code: 'CDK_ASSEMBLY_E1002',
      message: expect.stringContaining('FifoQueueNames'),
    }));
  });

  test('will capture all output', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'console-output');
    await using _ = await cx.produce();

    // THEN
    ['one', 'two', 'three', 'four'].forEach((line) => {
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'info',
        code: 'CDK_ASSEMBLY_I1001',
        message: `line ${line}`,
      }));
    });
  });

  test('cdk app failure leaves the directory unlocked', async () => {
    using out = autoCleanOutDir();
    const lock = new RWLock(out.dir);

    // GIVEN
    const cx = await toolkit.fromCdkApp('false', { outdir: out.dir });

    // WHEN
    await expect(cx.produce()).rejects.toThrow(/error 1/);

    // THEN: Don't expect either a read or write lock on the directory afterwards
    expect(await (lock! as any)._currentWriter()).toBeUndefined();
    expect(await (lock! as any)._currentReaders()).toEqual([]);
  });

  describe('abort', () => {
    /**
     * A CDK app that never finishes on its own, so the only way `produce()`
     * settles is if the abort signal kills the subprocess. A real app exits too
     * quickly to abort reliably.
     */
    const HANGING_APP = 'node -e "setInterval(() => {}, 1000)"';

    /**
     * Reject with a legible message if `promise` has not settled in time, rather
     * than letting the test sit until jest's own timeout. A hang is the failure
     * mode these tests guard against, so it has to fail fast and say why.
     */
    function withinMs<A>(promise: Promise<A>, ms: number): Promise<A> {
      return Promise.race([
        promise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error(`promise did not settle within ${ms}ms`)), ms).unref()),
      ]);
    }

    test('aborting the signal kills a running app', async () => {
      using out = autoCleanOutDir();
      const cx = await toolkit.fromCdkApp(HANGING_APP, { outdir: out.dir });
      const controller = new AbortController();

      // WHEN - the app is already running when the abort arrives
      const produced = cx.produce({ abort: controller.signal });
      setTimeout(() => controller.abort(), 200).unref();

      // THEN - the subprocess is signalled, surfacing as an assembly error
      await expect(withinMs(produced, 10_000)).rejects.toThrow(/killed with signal/);
    });

    test('aborting leaves the directory unlocked', async () => {
      using out = autoCleanOutDir();
      const lock = new RWLock(out.dir);
      const cx = await toolkit.fromCdkApp(HANGING_APP, { outdir: out.dir });
      const controller = new AbortController();

      // WHEN
      const produced = cx.produce({ abort: controller.signal });
      setTimeout(() => controller.abort(), 200).unref();
      await expect(withinMs(produced, 10_000)).rejects.toThrow(/killed with signal/);

      // THEN - an abort must clean up after itself as thoroughly as a failure
      // does, or the next synth self-conflicts on a stale lock.
      expect(await (lock! as any)._currentWriter()).toBeUndefined();
      expect(await (lock! as any)._currentReaders()).toEqual([]);
    });

    test('aborting during synth kills the app', async () => {
      // The abort has to survive the trip through `synth()`, which is how
      // callers actually reach `produce()`.
      using out = autoCleanOutDir();
      const cx = await toolkit.fromCdkApp(HANGING_APP, { outdir: out.dir });
      const controller = new AbortController();

      // WHEN
      const synthed = toolkit.synth(cx, { abort: controller.signal });
      setTimeout(() => controller.abort(), 200).unref();

      // THEN
      await expect(withinMs(synthed, 10_000)).rejects.toThrow(/killed with signal/);
    });

    test('a signal aborted before produce starts kills the app', async () => {
      // A caller that shuts down between building the source and producing it
      // hands over a signal that has already fired. Attaching an 'abort'
      // listener to such a signal never fires, so the already-aborted state has
      // to be checked up front or the app runs unsupervised forever.
      using out = autoCleanOutDir();
      const cx = await toolkit.fromCdkApp(HANGING_APP, { outdir: out.dir });

      // WHEN / THEN - must reject with the abort, not merely fail to settle
      await expect(withinMs(cx.produce({ abort: AbortSignal.abort() }), 5_000))
        .rejects.toThrow(/This operation was aborted/);
    });

    test('an un-aborted signal does not disturb a normal synth', async () => {
      // Guards the common case: passing a signal that never fires must behave
      // exactly like passing none.
      const cx = await appFixture(toolkit, 'two-empty-stacks');

      await using assembly = await cx.produce({ abort: new AbortController().signal });

      expect(assembly.cloudAssembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);
    });
  });

  describe('resolveDefaultEnvironment', () => {
    let prepareDefaultEnvironmentSpy: jest.SpyInstance;
    beforeEach(() => {
      // Mock the prepareDefaultEnvironment function to avoid actual STS calls
      prepareDefaultEnvironmentSpy = jest.spyOn(environment, 'prepareDefaultEnvironment')
        .mockImplementation(async () => {
          return {
            CDK_DEFAULT_ACCOUNT: '123456789012',
            CDK_DEFAULT_REGION: 'us-east-1',
          };
        });
    });

    afterEach(() => {
      prepareDefaultEnvironmentSpy.mockRestore();
    });

    test.each([[true, 1], [false, 0], [undefined, 1]])('respects resolveDefaultEnvironment=%s', async (resolveDefaultEnvironment, callCount) => {
      // GIVEN
      await using synthDir = autoCleanOutDir();

      // WHEN
      const cx = await toolkit.fromCdkApp('node -e "console.log(JSON.stringify(process.env))"', {
        workingDirectory: process.cwd(),
        outdir: synthDir.dir,
        resolveDefaultEnvironment,
      });

      try {
        await using _ = await cx.produce();
      } catch {
        // we expect this app to throw
      }

      // THEN
      expect(prepareDefaultEnvironmentSpy).toHaveBeenCalledTimes(callCount);
    });
  });
});

describe('fromAssemblyDirectory', () => {
  test('defaults', async () => {
    // WHEN
    const cx = await cdkOutFixture(toolkit, 'two-empty-stacks');
    await using assembly = await cx.produce();

    // THEN
    expect(assembly.cloudAssembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);
  });

  test('validates manifest version', async () => {
    // WHEN
    const cx = await cdkOutFixture(toolkit, 'manifest-from-the-future');

    // THEN
    await expect(() => cx.produce()).rejects.toThrow('This AWS CDK Toolkit is not compatible with the AWS CDK library used by your application');
  });

  test('fails on missing context', async () => {
    // WHEN
    const cx = await cdkOutFixture(toolkit, 'assembly-missing-context');

    // THEN
    await expect(() => cx.produce()).rejects.toThrow(/Assembly contains missing context./);
  });

  test('no fail on missing context', async () => {
    // WHEN
    const cx = await cdkOutFixture(toolkit, 'assembly-missing-context', { failOnMissingContext: false });

    // THEN
    await using assembly = await cx.produce();
    expect(assembly.cloudAssembly.manifest.missing?.length).toEqual(1);
  });

  test('can disable manifest version validation', async () => {
    // WHEN
    const cx = await cdkOutFixture(toolkit, 'manifest-from-the-future', {
      loadAssemblyOptions: {
        checkVersion: false,
      },
    });
    await using assembly = await cx.produce();

    // THEN
    expect(assembly.cloudAssembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1']);
  });
});

/**
 * A CDK app directory, the way a user's project looks: a `cdk.json` plus an app.
 *
 * The app is a plain Node script (no aws-cdk-lib) that records what synthesis
 * handed it -- the context and the environment variables derived from settings --
 * next to a minimal cloud assembly, so a test can assert on the app's own view of
 * its configuration instead of inferring it from a synthesized template.
 */
function cdkAppDirectory(cdkJson: Record<string, unknown>, extraFiles: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cdk-app-'));
  fs.writeJSONSync(path.join(dir, 'cdk.json'), { app: 'node app.js', ...cdkJson });
  fs.writeFileSync(path.join(dir, 'app.js'), [
    'const fs = require("fs");',
    'const path = require("path");',
    'const outdir = process.env.CDK_OUTDIR;',
    'fs.mkdirSync(outdir, { recursive: true });',
    'fs.writeFileSync(path.join(outdir, "manifest.json"), JSON.stringify({ version: "0.0.0", artifacts: {} }));',
    'fs.writeFileSync(path.join(outdir, "synth-input.json"), JSON.stringify({',
    '  context: JSON.parse(process.env.CDK_CONTEXT_JSON || "{}"),',
    '  cdkValidation: process.env.CDK_VALIDATION ?? null,',
    '  cwd: fs.realpathSync(process.cwd()),',
    '}));',
  ].join('\n'));
  for (const [name, content] of Object.entries(extraFiles)) {
    fs.writeJSONSync(path.join(dir, name), content);
  }

  return {
    dir,
    [Symbol.dispose]: () => fs.rmSync(dir, { force: true, recursive: true }),
  };
}

/** What the app recorded, read back out of the assembly it produced. */
function synthInput(assemblyDir: string): { context: Record<string, unknown>; cdkValidation: string | null; cwd: string } {
  return fs.readJSONSync(path.join(assemblyDir, 'synth-input.json'));
}

describe('fromCdkAppDirectory', () => {
  test('runs the app from cdk.json, in the app directory, into cdk.out', async () => {
    using app = cdkAppDirectory({});

    const cx = await toolkit.fromCdkAppDirectory(app.dir);
    await using result = await cx.produce();

    expect(result.cloudAssembly.directory).toEqual(path.join(app.dir, 'cdk.out'));
    expect(synthInput(result.cloudAssembly.directory).cwd).toEqual(app.dir);
  });

  test('honors the output directory from cdk.json', async () => {
    using app = cdkAppDirectory({ output: 'other.out' });

    const cx = await toolkit.fromCdkAppDirectory(app.dir);
    await using result = await cx.produce();

    expect(result.cloudAssembly.directory).toEqual(path.join(app.dir, 'other.out'));
  });

  test('fails with an actionable error when there is no cdk.json', async () => {
    using dir = autoCleanOutDir();

    await expect(toolkit.fromCdkAppDirectory(dir.dir)).rejects.toThrow(/cdk.json not found at/);
  });

  test('fails when cdk.json does not say how to run the app', async () => {
    using app = cdkAppDirectory({});
    fs.writeJSONSync(path.join(app.dir, 'cdk.json'), { output: 'cdk.out' });

    await expect(toolkit.fromCdkAppDirectory(app.dir)).rejects.toThrow(/missing "app" field/);
  });

  describe('context', () => {
    test('is read from cdk.json', async () => {
      using app = cdkAppDirectory({ context: { 'from-cdk-json': 'yes' } });

      const cx = await toolkit.fromCdkAppDirectory(app.dir);
      await using result = await cx.produce();

      expect(synthInput(result.cloudAssembly.directory).context).toMatchObject({ 'from-cdk-json': 'yes' });
    });

    test('is read from cdk.context.json, with cdk.json winning a conflict', async () => {
      // Same precedence as the CLI: a value the user wrote in cdk.json beats a
      // cached lookup in cdk.context.json.
      using app = cdkAppDirectory(
        { context: { shared: 'from-cdk-json' } },
        { 'cdk.context.json': { 'shared': 'from-context-json', 'only-in-context-json': 'yes' } },
      );

      const cx = await toolkit.fromCdkAppDirectory(app.dir);
      await using result = await cx.produce();

      expect(synthInput(result.cloudAssembly.directory).context).toMatchObject({
        'shared': 'from-cdk-json',
        'only-in-context-json': 'yes',
      });
    });
  });

  describe('settings', () => {
    test('are read from cdk.json and turned into app context', async () => {
      using app = cdkAppDirectory({ versionReporting: false, pathMetadata: false, staging: false });

      const cx = await toolkit.fromCdkAppDirectory(app.dir);
      await using result = await cx.produce();

      const context = synthInput(result.cloudAssembly.directory).context;
      expect(context).toMatchObject({
        'aws:cdk:disable-version-reporting': true,
        'aws:cdk:disable-asset-staging': true,
      });
      // Disabled settings are expressed by the *absence* of the enabling key.
      expect(context).not.toHaveProperty('aws:cdk:enable-path-metadata');
      expect(context).not.toHaveProperty('aws:cdk:version-reporting');
    });

    test('default to on when cdk.json says nothing', async () => {
      using app = cdkAppDirectory({});

      const cx = await toolkit.fromCdkAppDirectory(app.dir);
      await using result = await cx.produce();

      expect(synthInput(result.cloudAssembly.directory).context).toMatchObject({
        'aws:cdk:enable-path-metadata': true,
        'aws:cdk:enable-asset-metadata': true,
        'aws:cdk:version-reporting': true,
        'aws:cdk:bundling-stacks': ['**'],
      });
    });

    test('reach the app as an environment variable where that is how the framework reads them', async () => {
      using app = cdkAppDirectory({ validation: false });

      const cx = await toolkit.fromCdkAppDirectory(app.dir, {
        // The test harness sets CDK_VALIDATION itself; unset it so the only thing
        // that can put it back is the setting under test.
        env: { CDK_VALIDATION: undefined },
      });
      await using result = await cx.produce();

      expect(synthInput(result.cloudAssembly.directory).cdkValidation).toEqual('false');
    });

    test('are overridden by synthOptions, like the CLI command line overrides cdk.json', async () => {
      using app = cdkAppDirectory({ versionReporting: false, validation: false });

      const cx = await toolkit.fromCdkAppDirectory(app.dir, {
        synthOptions: { versionReporting: true, validation: true },
        env: { CDK_VALIDATION: undefined },
      });
      await using result = await cx.produce();

      const input = synthInput(result.cloudAssembly.directory);
      expect(input.context).toMatchObject({ 'aws:cdk:version-reporting': true });
      expect(input.context).not.toHaveProperty('aws:cdk:disable-version-reporting');
      // Validation is back on, so nothing switches it off for the app anymore.
      expect(input.cdkValidation).toBeNull();
    });

    test('are left alone by synthOptions that do not mention them', async () => {
      // `fromCdkAppDirectory` must not apply the API's own defaults on top of
      // cdk.json: overriding one setting may not silently reset the others.
      using app = cdkAppDirectory({ versionReporting: false, pathMetadata: false });

      const cx = await toolkit.fromCdkAppDirectory(app.dir, {
        synthOptions: { versionReporting: true },
      });
      await using result = await cx.produce();

      const context = synthInput(result.cloudAssembly.directory).context;
      expect(context).toMatchObject({ 'aws:cdk:version-reporting': true });
      expect(context).not.toHaveProperty('aws:cdk:enable-path-metadata');
    });

    test('are not clobbered by a synth option that is explicitly undefined', async () => {
      // Callers forwarding their own optional props end up passing `undefined`;
      // that must read as "not specified", not as "unset what cdk.json said".
      using app = cdkAppDirectory({ versionReporting: false });

      const cx = await toolkit.fromCdkAppDirectory(app.dir, {
        synthOptions: { versionReporting: undefined },
      });
      await using result = await cx.produce();

      expect(synthInput(result.cloudAssembly.directory).context).toMatchObject({
        'aws:cdk:disable-version-reporting': true,
      });
    });
  });
});
