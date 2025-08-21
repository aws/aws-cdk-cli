import { AssumeRoleCommand } from '@aws-sdk/client-sts';
import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('deploy role cannot be assumed with external id', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
  });

  const account = await fixture.aws.account();
  const deployRoleArn = `arn:aws:iam::${account}:role/cdk-${fixture.qualifier}-deploy-role-${account}-${fixture.aws.region}`;

  // Attempt to assume the deploy role with an external ID should fail
  await expect(
    fixture.aws.sts.send(new AssumeRoleCommand({
      RoleArn: deployRoleArn,
      RoleSessionName: 'test-external-id-failure',
      ExternalId: 'some-external-id',
    })),
  ).rejects.toThrow();
}));

integTest('deploy role can be assumed with ExternalId if protection is switched off', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    toolkitStackName: bootstrapStackName,
    cfnExecutionPolicy: 'arn:aws:iam::aws:policy/AdministratorAccess',
    denyExternalId: false,
  });

  const account = await fixture.aws.account();
  const deployRoleArn = `arn:aws:iam::${account}:role/cdk-${fixture.qualifier}-deploy-role-${account}-${fixture.aws.region}`;

  // Attempt to assume the deploy role with an external ID should fail
  await expect(
    fixture.aws.sts.send(new AssumeRoleCommand({
      RoleArn: deployRoleArn,
      RoleSessionName: 'test-external-id-failure',
      ExternalId: 'some-external-id',
    })),
  ).resolves.toBeTruthy();
}));
