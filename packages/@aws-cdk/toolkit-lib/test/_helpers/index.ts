import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AssemblyDirectoryProps, FromCdkAppOptions, ICloudAssemblySource } from '../../lib';
import { ToolkitError } from '../../lib';
import type { CloudAssemblySourceBuilder } from '../../lib/api/cloud-assembly/private';

export * from './test-cloud-assembly-source';
export * from './test-io-host';

function fixturePath(...parts: string[]): string {
  return path.normalize(path.join(__dirname, '..', '_fixtures', ...parts));
}

export async function appFixture(toolkit: CloudAssemblySourceBuilder, name: string, options?: Omit<FromCdkAppOptions, 'workingDirectory' | 'outdir'>) {
  const appPath = fixturePath(name, 'app.js');
  if (!fs.existsSync(appPath)) {
    throw new ToolkitError(`App Fixture ${name} does not exist in ${appPath}`);
  }
  const app = `cat ${appPath} | node --input-type=module`;
  return toolkit.fromCdkApp(app, {
    workingDirectory: path.join(__dirname, '..', '..'),
    outdir: tmpOutdir(),
    ...options,
  });
}

export function builderFixture(toolkit: CloudAssemblySourceBuilder, name: string, context?: { [key: string]: any }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const builder = require(path.join(__dirname, '..', '_fixtures', name)).default;
  return toolkit.fromAssemblyBuilder(builder, {
    outdir: tmpOutdir(),
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
