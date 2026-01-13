import { integTest, withTemporaryDirectory, ShellHelper, withPackages } from '../../lib';

integTest('typescript init lib', withTemporaryDirectory(withPackages(async (context) => {
  const shell = ShellHelper.fromContext(context);
  await context.cli.makeCliAvailable();

  await shell.shell(['cdk', 'init', '--lib-version', context.library.requestedVersion(), '-l', 'typescript', 'lib']);

  await shell.shell(['npm', 'prune']);
  await shell.shell(['npm', 'ls']); // this will fail if we have unmet peer dependencies
  await shell.shell(['npm', 'run', 'build']);
  await shell.shell(['npm', 'run', 'test']);
})));
