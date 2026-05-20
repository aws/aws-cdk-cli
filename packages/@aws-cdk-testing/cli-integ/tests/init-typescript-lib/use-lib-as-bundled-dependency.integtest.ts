import * as fs from 'fs/promises';
import { integTest, withTemporaryDirectory, ShellHelper, withPackages } from '../../lib';

// Sometimes, due to our own use of bundled dependencies, NPM will fail if a customer declares
// aws-cdk-lib as a bundled dependency. Test whether that still works.
integTest('using aws-cdk-lib as a bundled dependency', withTemporaryDirectory(withPackages(async (context) => {
  const shell = ShellHelper.fromContext(context);
  await context.cli.makeCliAvailable();

  await shell.shell(['npm', 'init', '-y']);

  const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8'));

  packageJson.dependencies = {
    ...packageJson.dependencies,
    'aws-cdk-lib': context.library.requestedVersion(),
  };
  packageJson.bundleDependencies = ['aws-cdk-lib'];

  await fs.writeFile('package.json', JSON.stringify(packageJson, undefined, 2), 'utf-8');

  await shell.shell(['npm', 'install']);
})));
