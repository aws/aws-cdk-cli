import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CreatePolicyCommand, DeletePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';
import { integTest, withoutBootstrap } from '../../lib';
import eventually from '../../lib/eventually';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('can remove customPermissionsBoundary', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;
  const policyName = `${bootstrapStackName}-pb`;
  let policyArn;
  try {
    const policy = await fixture.aws.iam.send(
      new CreatePolicyCommand({
        PolicyName: policyName,
        PolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: {
            Action: ['*'],
            Resource: ['*'],
            Effect: 'Allow',
          },
        }),
      }),
    );
    policyArn = policy.Policy?.Arn;

    // Policy creation and consistency across regions is "almost immediate"
    // See: https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_general.html#troubleshoot_general_eventual-consistency
    // We will put this in an `eventually` block to retry stack creation with a reasonable timeout
    const createStackWithPermissionBoundary = async (): Promise<void> => {
      await fixture.cdkBootstrapModern({
        // toolkitStackName doesn't matter for this particular invocation
        toolkitStackName: bootstrapStackName,
        customPermissionsBoundary: policyName,
      });

      const response = await fixture.aws.cloudFormation.send(
        new DescribeStacksCommand({ StackName: bootstrapStackName }),
      );
      expect(
        response.Stacks?.[0].Parameters?.some(
          param => (param.ParameterKey === 'InputPermissionsBoundary' && param.ParameterValue === policyName),
        )).toEqual(true);
    };

    await eventually(createStackWithPermissionBoundary, { maxAttempts: 3 });

    await fixture.cdkBootstrapModern({
      // toolkitStackName doesn't matter for this particular invocation
      toolkitStackName: bootstrapStackName,
      usePreviousParameters: false,
    });
    const response2 = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({ StackName: bootstrapStackName }),
    );
    expect(
      response2.Stacks?.[0].Parameters?.some(
        param => (param.ParameterKey === 'InputPermissionsBoundary' && !param.ParameterValue),
      )).toEqual(true);

    const region = fixture.aws.region;
    const account = await fixture.aws.account();
    const role = await fixture.aws.iam.send(
      new GetRoleCommand({ RoleName: `cdk-${fixture.qualifier}-cfn-exec-role-${account}-${region}` }),
    );
    if (!role.Role) {
      throw new Error('Role not found');
    }
    expect(role.Role.PermissionsBoundary).toBeUndefined();
  } finally {
    if (policyArn) {
      await fixture.aws.iam.send(new DeletePolicyCommand({ PolicyArn: policyArn }));
    }
  }
}));

