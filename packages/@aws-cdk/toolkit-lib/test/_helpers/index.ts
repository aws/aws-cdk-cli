import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AssemblyBuilder, AssemblyDirectoryProps, FromCdkAppOptions, ICloudAssemblySource } from '../../lib';
import type { CloudAssemblySourceBuilder } from '../../lib/api/cloud-assembly/private';
import { ToolkitError } from '../../lib/toolkit/toolkit-error';

export * from './test-cloud-assembly-source';
export * from './test-io-host';

function fixturePath(...parts: string[]): string {
  const ret = path.normalize(path.join(__dirname, '..', '_fixtures', ...parts));
  if (!fs.existsSync(ret)) {
    throw new ToolkitError(`App Fixture not found: ${ret}`);
  }
  return ret;
}

/**
 * Return config we can send into `fromCdkApp` to execute a given app fixture
 */
export function appFixtureConfig(name: string) {
  const appPath = fixturePath(name, 'app.js');
  return {
    app: `cat ${appPath} | node --input-type=module`,
    workingDirectory: path.join(__dirname, '..', '..'),
  };
}

export async function appFixture(toolkit: CloudAssemblySourceBuilder, name: string, options?: Omit<FromCdkAppOptions, 'workingDirectory' | 'outdir'>) {
  const app = appFixtureConfig(name);
  return toolkit.fromCdkApp(app.app, {
    workingDirectory: app.workingDirectory,
    outdir: tmpOutdir(),
    disposeOutdir: true,
    ...options,
  });
}

/**
 * Loads a builder from a directory that contains an 'index.js' with a default export
 */
export function builderFunctionFromFixture(builderName: string): AssemblyBuilder {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(__dirname, '..', '_fixtures', builderName)).default;
}

export function builderFixture(toolkit: CloudAssemblySourceBuilder, name: string, context?: { [key: string]: any }) {
  const builder = builderFunctionFromFixture(name);
  return toolkit.fromAssemblyBuilder(builder, {
    outdir: tmpOutdir(),
    disposeOutdir: true,
    context,
  });
}

export function cdkOutFixture(toolkit: CloudAssemblySourceBuilder, name: string, props: AssemblyDirectoryProps = {}) {
  const outdir = path.join(__dirname, '..', '_fixtures', name, 'cdk.out');
  if (!fs.existsSync(outdir)) {
    throw new ToolkitError(`Assembly Dir Fixture ${name} does not exist in ${outdir}`);
  }
  return toolkit.fromAssemblyDirectory(outdir, props);
}

function tmpOutdir(): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cdk.out'));
}

/**
 * A temporary directory that cleans when it goes out of scope
 *
 * Use with `using`. Could have been async but it's depending
 * on an already-sync API, so why not sync?
 */
export function autoCleanOutDir() {
  const dir = tmpOutdir();
  return {
    dir,
    [Symbol.dispose]: async () => {
      fs.rmSync(dir, { force: true, recursive: true });
    },
  };
}

export async function disposableCloudAssemblySource(
  toolkit: CloudAssemblySourceBuilder,
): Promise<[ICloudAssemblySource, ReturnType<typeof jest.fn>, () => Promise<void>]> {
  // We just need any kind of assembly
  const fixtureSource = await cdkOutFixture(toolkit, 'stack-with-bucket');
  const cloudAssembly = await fixtureSource.produce();

  const mockDispose = jest.fn();
  const assemblySource: ICloudAssemblySource = {
    produce() {
      return Promise.resolve({
        cloudAssembly: cloudAssembly.cloudAssembly,

        _unlock: jest.fn(),

        // Doesn't matter which one we use
        dispose: mockDispose,
        [Symbol.asyncDispose]: mockDispose,
      });
    },
  };

  return [assemblySource, mockDispose, () => cloudAssembly.dispose()];
}
