import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { integTest, withoutBootstrap } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('a customized template vendor will not overwrite the default template', withoutBootstrap(async (fixture) => {
  // Initial bootstrap
  const toolkitStackName = fixture.bootstrapStackName;
  await fixture.cdkBootstrapModern({
    toolkitStackName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });

  // Customize template
  const templateStr = await fixture.cdkBootstrapModern({
    // toolkitStackName doesn't matter for this particular invocation
    toolkitStackName,
    showTemplate: true,
    cliOptions: {
      captureStderr: false,
    },
  });

  const template = yaml.parse(templateStr, { schema: 'core' });
  template.Parameters.BootstrapVariant.Default = 'CustomizedVendor';
  const filename = path.join(fixture.integTestDir, `${fixture.qualifier}-template.yaml`);
  fs.writeFileSync(filename, yaml.stringify(template, { schema: 'yaml-1.1' }), { encoding: 'utf-8' });

  // Rebootstrap. For some reason, this doesn't cause a failure, it's a successful no-op.
  const output = await fixture.cdkBootstrapModern({
    toolkitStackName,
    template: filename,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
    cliOptions: {
      captureStderr: true,
    },
  });
  expect(output).toContain('Not overwriting it with a template containing');
}));

