import { CreateRoleCommand, DeleteRoleCommand, DeleteRolePolicyCommand, ListRolePoliciesCommand, PutRolePolicyCommand } from '@aws-sdk/client-iam';
import { AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { integTest, retry, withDefaultFixture, sleep } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy with role',
  withDefaultFixture(async (fixture) => {
    if (fixture.packages.majorVersion() !== '1') {
      return; // Nothing to do
    }

    const roleName = `${fixture.stackNamePrefix}-test-role`;

    await deleteRole();

    const createResponse = await fixture.aws.iam.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Principal: { Service: 'cloudformation.amazonaws.com' },
              Effect: 'Allow',
            },
            {
              Action: 'sts:AssumeRole',
              Principal: { AWS: (await fixture.aws.sts.send(new GetCallerIdentityCommand({}))).Arn },
              Effect: 'Allow',
            },
          ],
        }),
      }),
    );

    if (!createResponse.Role) {
      throw new Error('Role is expected to be present!!');
    }

    if (!createResponse.Role.Arn) {
      throw new Error('Role arn is expected to be present!!');
    }

    const roleArn = createResponse.Role.Arn;
    try {
      await fixture.aws.iam.send(
        new PutRolePolicyCommand({
          RoleName: roleName,
          PolicyName: 'DefaultPolicy',
          PolicyDocument: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Action: '*',
                Resource: '*',
                Effect: 'Allow',
              },
            ],
          }),
        }),
      );

      await retry(fixture.output, 'Trying to assume fresh role', retry.forSeconds(300), async () => {
        await fixture.aws.sts.send(
          new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: 'testing',
          }),
        );
      });

      // In principle, the role has replicated from 'us-east-1' to wherever we're testing.
      // Give it a little more sleep to make sure CloudFormation is not hitting a box
      // that doesn't have it yet.
      await sleep(5000);

      await fixture.cdkDeploy('test-2', {
        options: ['--role-arn', roleArn],
      });

      // Immediately delete the stack again before we delete the role.
      //
      // Since roles are sticky, if we delete the role before the stack, subsequent DeleteStack
      // operations will fail when CloudFormation tries to assume the role that's already gone.
      await fixture.cdkDestroy('test-2');
    } finally {
      await deleteRole();
    }

    async function deleteRole() {
      try {
        const response = await fixture.aws.iam.send(new ListRolePoliciesCommand({ RoleName: roleName }));

        if (!response.PolicyNames) {
          throw new Error('Policy names cannot be undefined for deleteRole() function');
        }

        for (const policyName of response.PolicyNames) {
          await fixture.aws.iam.send(
            new DeleteRolePolicyCommand({
              RoleName: roleName,
              PolicyName: policyName,
            }),
          );
        }
        await fixture.aws.iam.send(new DeleteRoleCommand({ RoleName: roleName }));
      } catch (e: any) {
        if (e.message.indexOf('cannot be found') > -1) {
          return;
        }
        throw e;
      }
    }
  }),
);

