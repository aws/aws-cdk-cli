import * as fs from 'fs';
import * as path from 'path';
// import { CreateSecretCommand, DeleteSecretCommand } from '@aws-sdk/client-secrets-manager';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
// eslint-disable-next-line import/no-relative-packages
import type { DockerDomainCredentialSource } from '../../../../../@aws-cdk/cdk-assets-lib/lib/private/docker-credentials';
import type { TestFixture } from '../../../lib';
import { integTest, withDefaultFixture, withRetry, retry } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'docker-credential-cdk-assets can assume role and fetch ECR credentials',
  withRetry(withDefaultFixture(async (fixture) => {
    const caller = await fixture.aws.sts.send(new GetCallerIdentityCommand({}));

    const roleArn = await fixture.aws.temporaryRole('ecr-repo-role', [
      {
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
        Principal: { AWS: caller.Account },
      },
    ], [
      {
        Effect: 'Allow',
        Resource: '*',
        Action: ['ecr:GetAuthorizationToken'],
      },
    ]);

    await fixture.aws.waitForAssumeRole(roleArn);

    await testDockerCredential(fixture, {
      ecrRepository: true,
      // This role must have permissions to call `ecr:GetAuthorizationToken`
      assumeRoleArn: roleArn,
    });
  })),
);

/*

// SKIPPED FOR NOW
// Requires SecretsManager permissions on the role that's executing this, and that's
// too much to set up right now.

integTest(
  'docker-credential-cdk-assets read from SecretsManager',
  withDefaultFixture(async (fixture) => {
    const secret = await fixture.aws.secretsManager.send(new CreateSecretCommand({
      Name: `our-secret-${fixture.randomString}`,
      SecretString: JSON.stringify({
        username: 'test-user',
        password: 'test-password',
      }),
    }));
    fixture.aws.addCleanup(() => fixture.aws.secretsManager.send(new DeleteSecretCommand({
      SecretId: secret.ARN,
    })));

    await testDockerCredential(fixture, {
      secretsManagerSecretId: secret.ARN,
      secretsUsernameField: 'username',
      secretsPasswordField: 'password',
    });
  }),
);

*/

async function testDockerCredential(fixture: TestFixture, credSource: DockerDomainCredentialSource) {
  const domain = 'integ.test.domain';
  const credsFilePath = path.join(fixture.integTestDir, 'cdk-docker-creds.json');

  fs.writeFileSync(credsFilePath, JSON.stringify({
    version: '1.0',
    domainCredentials: {
      [domain]: credSource,
    },
  }));

  const input = path.join(fixture.integTestDir, 'input.txt');
  fs.writeFileSync(input, `${domain}\n`);

  await fixture.cdkAssets.makeCliAvailable();
  let output: string = '';
  await retry(process.stdout, 'Getting docker credentials', retry.forSeconds(60), async () => {
    output = await fixture.shell(['docker-credential-cdk-assets', 'get'], {
      modEnv: {
        ...fixture.cdkShellEnv(),
        CDK_DOCKER_CREDS_FILE: credsFilePath,
      },
      stdio: [fs.openSync(input, 'r')],
      captureStderr: false,
    });
  });

  const response = JSON.parse(output);
  expect(response).toMatchObject({
    Username: expect.anything(),
    Secret: expect.anything(),
  });
}
