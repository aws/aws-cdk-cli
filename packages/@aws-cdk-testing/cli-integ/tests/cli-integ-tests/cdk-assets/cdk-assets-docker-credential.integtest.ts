import * as fs from 'fs';
import * as path from 'path';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'docker-credential-cdk-assets can be invoked as a program',
  withDefaultFixture(async (fixture) => {
    await fixture.shell(['npm', 'init', '-y']);
    await fixture.shell(['npm', 'install', 'cdk-assets@latest']);

    const caller = await fixture.aws.sts.send(new GetCallerIdentityCommand());
    const domain = 'integ.test.domain';
    const credsFilePath = path.join(fixture.integTestDir, 'cdk-docker-creds.json');

    fs.writeFileSync(credsFilePath, JSON.stringify({
      version: '1.0',
      domainCredentials: {
        [domain]: {
          ecrRepository: true,
          roleArn: caller.Arn,
        },
      },
    }));

    const input = path.join(fixture.integTestDir, 'input.txt');
    fs.writeFileSync(input, `${domain}\n`);

    await fixture.shell(['node', './node_modules/cdk-assets/bin/docker-credential-cdk-assets', 'get'], {
      modEnv: {
        ...fixture.cdkShellEnv(),
        CDK_DOCKER_CREDS_FILE: credsFilePath,
      },
      stdio: [fs.openSync(input, 'r')],
    });
  }),
);
