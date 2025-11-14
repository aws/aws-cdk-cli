import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy stack without resource',
  withDefaultFixture(async (fixture) => {
    // Deploy the stack without resources
    await fixture.cdkDeploy('conditional-resource', { modEnv: { NO_RESOURCE: 'TRUE' } });

    // This should have succeeded but not deployed the stack.
    await expect(
      fixture.aws.cloudFormation.send(
        new DescribeStacksCommand({ StackName: fixture.fullStackName('conditional-resource') }),
      ),
    ).rejects.toThrow('conditional-resource does not exist');

    // Deploy the stack with resources
    await fixture.cdkDeploy('conditional-resource');

    // Then again WITHOUT resources (this should destroy the stack)
    await fixture.cdkDeploy('conditional-resource', { modEnv: { NO_RESOURCE: 'TRUE' } });

    await expect(
      fixture.aws.cloudFormation.send(
        new DescribeStacksCommand({ StackName: fixture.fullStackName('conditional-resource') }),
      ),
    ).rejects.toThrow('conditional-resource does not exist');
  }),
);

