import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate --no-online skips CloudFormation validation',
  withSpecificFixture('validate-online-app', async (fixture) => {
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', '--no-online', fixture.fullStackName('validate-online-invalid')],
    );

    // With --no-online, the invalid resource type should NOT be caught
    expect(output).not.toContain('AWS::Fake::DoesNotExist');
    expect(output).not.toContain('CloudFormation');
  }),
);
