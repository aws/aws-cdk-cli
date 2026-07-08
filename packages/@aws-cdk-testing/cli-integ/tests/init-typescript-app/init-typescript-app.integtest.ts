import { promises as fs } from 'fs';
import * as path from 'path';
import type { TemporaryDirectoryContext } from '../../lib';
import { integTest, withTemporaryDirectory, ShellHelper, withPackages } from '../../lib';
import { typescriptVersionsSync, typescriptVersionsYoungerThanDaysSync } from '../../lib/npm';

['app', 'sample-app'].forEach(template => {
  integTest(`typescript init ${template}`, withTemporaryDirectory(withPackages(async (context) => {
    const shell = ShellHelper.fromContext(context);
    await context.cli.makeCliAvailable();

    await shell.shell(['cdk', 'init', '--lib-version', context.library.requestedVersion(), '-l', 'typescript', template]);

    await shell.shell(['npm', 'ci']); // this will fail if we have bundled dependencies that introduce version conflicts

    await shell.shell(['npm', 'prune']);
    await shell.shell(['npm', 'ls']); // this will fail if we have unmet peer dependencies
    await shell.shell(['npm', 'run', 'build']);
    await shell.shell(['npm', 'run', 'test']);

    await shell.shell(['cdk', 'synth']);
  })), 300_000);
});

// Same as https://github.com/DefinitelyTyped/DefinitelyTyped?tab=readme-ov-file#support-window
const TYPESCRIPT_VERSION_AGE_DAYS = 2 * 365;

const TYPESCRIPT_VERSIONS = typescriptVersionsYoungerThanDaysSync(TYPESCRIPT_VERSION_AGE_DAYS, typescriptVersionsSync());

/**
 * Test our generated code with various versions of TypeScript
 */
TYPESCRIPT_VERSIONS.forEach(tsVersion => {
  integTest(`typescript ${tsVersion} init app`, withTemporaryDirectory(withPackages(async (context) => {
    const shell = ShellHelper.fromContext(context);
    await context.cli.makeCliAvailable();

    await shell.shell(['node', '--version']);
    await shell.shell(['npm', '--version']);

    await shell.shell(['cdk', 'init', '--lib-version', context.library.requestedVersion(), '-l', 'typescript', 'app', '--generate-only']);

    // Necessary because recent versions of ts-jest require TypeScript>=4.3 but we
    // still want to test with older versions as well.
    await removeDevDependencies(context);

    // The generated app compiles and runs through `tsc && node` — the TypeScript
    // compiler itself is the only toolchain needed for `cdk synth`.
    await shell.shell(['npm', 'install', '--save-dev', `typescript@${tsVersion}`]);

    await shell.shell(['npm', 'install']); // Older versions of npm require this to be a separate step from the one above

    await shell.shell(['npx', 'tsc', '--version']);
    await shell.shell(['npm', 'prune']);
    await shell.shell(['npm', 'ls']); // this will fail if we have unmet peer dependencies

    // We just removed the 'jest' dependency so remove the tests as well because they won't compile
    await shell.shell(['rm', '-rf', 'test/']);

    await shell.shell(['npm', 'run', 'build']);
    await shell.shell(['cdk', 'synth']);
  })));
});

async function removeDevDependencies(context: TemporaryDirectoryContext) {
  const filename = path.join(context.integTestDir, 'package.json');
  const pj = JSON.parse(await fs.readFile(filename, { encoding: 'utf-8' }));
  delete pj.devDependencies;
  await fs.writeFile(filename, JSON.stringify(pj, undefined, 2), { encoding: 'utf-8' });

  // The generated tsconfig explicitly lists the @types packages we just removed;
  // with them gone, tsc would fail on the missing type definition files.
  const tsconfigFilename = path.join(context.integTestDir, 'tsconfig.json');
  const tsconfig = JSON.parse(await fs.readFile(tsconfigFilename, { encoding: 'utf-8' }));
  delete tsconfig.compilerOptions.types;
  await fs.writeFile(tsconfigFilename, JSON.stringify(tsconfig, undefined, 2), { encoding: 'utf-8' });
}
