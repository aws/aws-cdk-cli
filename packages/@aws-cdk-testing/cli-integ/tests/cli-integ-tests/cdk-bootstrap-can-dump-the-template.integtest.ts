import * as fs from 'fs';
import * as path from 'path';
import { integTest, withoutBootstrap } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('can dump the template, modify and use it to deploy a custom bootstrap stack', withoutBootstrap(async (fixture) => {
  let template = await fixture.cdkBootstrapModern({
    // toolkitStackName doesn't matter for this particular invocation
    toolkitStackName: fixture.bootstrapStackName,
    showTemplate: true,
    cliOptions: {
      captureStderr: false,
    },
  });

  expect(template).toContain('BootstrapVersion:');

  template += '\n' + [
    '  TwiddleDee:',
    '    Value: Template got twiddled',
  ].join('\n');

  const filename = path.join(fixture.integTestDir, `${fixture.qualifier}-template.yaml`);
  fs.writeFileSync(filename, template, { encoding: 'utf-8' });
  await fixture.cdkBootstrapModern({
    toolkitStackName: fixture.bootstrapStackName,
    template: filename,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });
}));

