import { integTest, withTemporaryDirectory, ShellHelper, withPackages } from '../../lib';

['app', 'sample-app'].forEach(template => {
  integTest(`init java ${template}`, withTemporaryDirectory(withPackages(async (context) => {
    context.library.assertJsiiPackagesAvailable();

    const shell = ShellHelper.fromContext(context);
    await context.cli.makeCliAvailable();

    await shell.shell(['cdk', 'init', '--lib-version', context.library.requestedVersion(), '-l', 'java', template]);
    await shell.shell(['mvn', 'package']);
    await shell.shell(['cdk', 'synth']);
  })));
});
