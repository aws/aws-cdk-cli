import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate --online catches invalid resource type',
  withSpecificFixture('validate-online-app', async (fixture) => {
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', '--online', fixture.fullStackName('validate-online-invalid')],
      {
        allowErrExit: true,
      },
    );

    expect(output).toContain('CloudFormation');
    expect(output).toContain('AWS::Fake::DoesNotExist');
  }),
);
