import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy with parameters multi',
  withDefaultFixture(async (fixture) => {
    const paramVal1 = `${fixture.stackNamePrefix}bazinga`;
    const paramVal2 = `${fixture.stackNamePrefix}=jagshemash`;

    const stackArn = await fixture.cdkDeploy('param-test-3', {
      options: ['--parameters', `DisplayNameParam=${paramVal1}`, '--parameters', `OtherDisplayNameParam=${paramVal2}`],
      captureStderr: false,
    });

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );

    expect(response.Stacks?.[0].Parameters).toContainEqual({
      ParameterKey: 'DisplayNameParam',
      ParameterValue: paramVal1,
    });
    expect(response.Stacks?.[0].Parameters).toContainEqual({
      ParameterKey: 'OtherDisplayNameParam',
      ParameterValue: paramVal2,
    });
  }),
);

