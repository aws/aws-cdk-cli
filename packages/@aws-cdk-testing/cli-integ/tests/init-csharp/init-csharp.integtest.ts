import { integTest, withTemporaryDirectory, ShellHelper, withPackages } from '../../lib';

['app', 'sample-app'].forEach(template => {
  integTest(`init C♯ ${template}`, withTemporaryDirectory(withPackages(async (context) => {
    context.library.assertJsiiPackagesAvailable();

    const shell = ShellHelper.fromContext(context);
    await context.cli.makeCliAvailable();

    await shell.shell(['cdk', 'init', '--lib-version', context.library.requestedVersion(), '-l', 'csharp', template]);
    await context.library.initializeDotnetPackages(context.integTestDir);
    await shell.shell(['cdk', 'synth']);
  })), 300_000);
});

