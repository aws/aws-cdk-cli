import { promises as fs } from 'fs';
import * as path from 'path';
import { withToolContext } from './with-tool-context';
import type { TemporaryDirectoryContext } from '../../lib';
import { integTest, ShellHelper } from '../../lib';

const TIMEOUT = 1800_000;

integTest('amplify integration', withToolContext(async (context) => {
  const shell = ShellHelper.fromContext(context);

  ////////////////////////////////////////////////////////////////////////
  //  Make sure that create-amplify installs the right versions of the CLI and framework
  //

  // Install `create-amplify` without running it, then hack the json file with the
  // package versions in it before we execute.
  await shell.shell(['npm', 'init', '-y']);

  // using --force because amplify pins the (transitive) @aws-cdk/toolkit-lib dependency.
  // in pre-release environments (like integ workflow on github) @aws-cdk/toolkit-lib will
  // only be available in its pre-release version.
  // see https://github.com/search?q=repo%3Aaws-amplify%2Famplify-backend%20%22%40aws-cdk%2Ftoolkit-lib%22%3A%20%220.3.2%22&type=code
  await shell.shell(['npm', 'install', '--force', '--save-dev', 'create-amplify@latest']);

  // monkey patch node_modules to use the pre-release version of @aws-cdk/toolkit-lib
  await shell.shell(['rm', '-rf', path.join(context.integTestDir, 'node_modules', '@aws-cdk', 'toolkit-lib')]);
  await shell.shell(['npm', 'install', '--save-dev', `@aws-cdk/toolkit-lib@${context.toolkitLib.requestedVersion()}`]);

  // This will create 'package.json' implicating a certain version of the CDK
  await shell.shell(['npm', 'config', 'set', 'save-exact', 'true']);
  await mutateAmplifyDepOnCdk(context, context.cli.requestedVersion(), context.library.requestedVersion());

  ////////////////////////////////////////////////////////////////////////
  //  Run the `npm create` workflow
  //

  // I tested to confirm that this will use the locally installed `create-amplify`
  await shell.shell(['npm', 'create', '-y', 'amplify']);
  await shell.shell(['npx', 'ampx', 'configure', 'telemetry', 'disable']);

  const awsCreds = context.aws.identityEnv();

  await shell.shell(['npx', 'ampx', 'sandbox', '--once'], {
    modEnv: {
      AWS_REGION: context.aws.region,
      ...awsCreds,
    },
  });
  try {

    // Future code goes here, putting the try/finally here already so it doesn't
    // get forgotten.

  } finally {
    await shell.shell(['npx', 'ampx', 'sandbox', 'delete', '--yes'], {
      modEnv: {
        AWS_REGION: context.aws.region,
        ...awsCreds,
      },
    });
  }
}), TIMEOUT);

async function mutateAmplifyDepOnCdk(context: TemporaryDirectoryContext, cliVersion: string, libVersion: string) {
  // default_packages.json is where create-amplify reads when installing npm dependencies
  const amplifyDepFile = path.join(context.integTestDir, 'node_modules', 'create-amplify', 'lib', 'default_packages.json');
  const amplifyDepJson: unknown = JSON.parse(await fs.readFile(amplifyDepFile, { encoding: 'utf-8' }));

  // Be extra paranoid about the types here, since we don't fully control them
  assertIsObject(amplifyDepJson);
  assertIsStringArray(amplifyDepJson.defaultDevPackages);

  // Amplify is removing the dependency on aws-cdk, since Amplify is now using the toolkit-lib
  // To prepare for this change, we need allow both situations: aws-cdk being listed and not being listed
  // Fix is to simply allow the replace operation to also NOT replace the version
  // @see https://github.com/aws-amplify/amplify-backend/pull/2614
  replacePackageVersionIn('aws-cdk', cliVersion, amplifyDepJson.defaultDevPackages, false);
  replacePackageVersionIn('aws-cdk-lib', libVersion, amplifyDepJson.defaultDevPackages);

  await fs.writeFile(amplifyDepFile, JSON.stringify(amplifyDepJson, undefined, 2), { encoding: 'utf-8' });

  const packageJsonFile = path.join(context.integTestDir, 'package.json');
  const packageJson: unknown = JSON.parse(await fs.readFile(packageJsonFile, { encoding: 'utf-8' }));

  assertIsObject(packageJson);
  packageJson.overrides = {
    'aws-cdk-lib': libVersion,
  };
  await fs.writeFile(packageJsonFile, JSON.stringify(packageJson, undefined, 2), { encoding: 'utf-8' });
}

/**
 * Mutably update the given string array, replacing the version of packages with the given name
 *
 * We assume the list of packages is a string array of the form
 *
 * ```
 * ["package@version", "package@version", ...]
 * ```
 *
 * It's a failure if we don't find an entry to update, unless we explicitly pass an option to say that's okay.
 */
function replacePackageVersionIn(packName: string, version: string, xs: string[], failIfMissing = true) {
  let didUpdate = false;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].startsWith(`${packName}@`)) {
      xs[i] = `${packName}@${version}`;
      didUpdate = true;
    }
  }

  if (failIfMissing && !didUpdate) {
    throw new Error(`Did not find a package version to update for ${packName} in ${JSON.stringify(xs)}`);
  }
}

function assertIsObject(xs: unknown): asserts xs is Record<string, unknown> {
  if (typeof xs !== 'object' || xs === null) {
    throw new Error(`Expected object, got ${JSON.stringify(xs)}`);
  }
}

function assertIsStringArray(xs: unknown): asserts xs is string[] {
  if (!Array.isArray(xs) || xs.length === 0 || typeof xs[0] !== 'string') {
    throw new Error(`Expected list of strings, got ${JSON.stringify(xs)}`);
  }
}
