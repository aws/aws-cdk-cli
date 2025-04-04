import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AssemblyDirectoryProps, Toolkit } from '../../lib';
import { ToolkitError } from '../../lib';

export * from './test-cloud-assembly-source';
export * from './test-io-host';

function fixturePath(...parts: string[]): string {
  return path.normalize(path.join(__dirname, '..', '_fixtures', ...parts));
}

export async function appFixture(toolkit: Toolkit, name: string, context?: { [key: string]: any }) {
  const appPath = fixturePath(name, 'app.js');
  if (!fs.existsSync(appPath)) {
    throw new ToolkitError(`App Fixture ${name} does not exist in ${appPath}`);
  }
  const app = `cat ${appPath} | node --input-type=module`;
  return toolkit.fromCdkApp(app, {
    workingDirectory: path.join(__dirname, '..', '..'),
    outdir: tmpOutdir(),
    context,
  });
}

export function builderFixture(toolkit: Toolkit, name: string, context?: { [key: string]: any }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const builder = require(path.join(__dirname, '..', '_fixtures', name)).default;
  return toolkit.fromAssemblyBuilder(builder, {
    outdir: tmpOutdir(),
    context,
  });
}

export function cdkOutFixture(toolkit: Toolkit, name: string, props: AssemblyDirectoryProps = {}) {
  const outdir = path.join(__dirname, '..', '_fixtures', name, 'cdk.out');
  if (!fs.existsSync(outdir)) {
    throw new ToolkitError(`Assembly Dir Fixture ${name} does not exist in ${outdir}`);
  }
  return toolkit.fromAssemblyDirectory(outdir, props);
}

function tmpOutdir(): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cdk.out'));
}
