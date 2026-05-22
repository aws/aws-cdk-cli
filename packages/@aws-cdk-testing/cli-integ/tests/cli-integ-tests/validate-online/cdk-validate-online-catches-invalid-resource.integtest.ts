import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate --online catches bucket name conflict',
  withSpecificFixture('validate-online-app', async (fixture) => {
    // Deploy a stack that owns the bucket
    await fixture.cdk(
      ['deploy', '--require-approval=never', fixture.fullStackName('validate-online-deployed')],
    );

    // Now validate a stack that tries to create the same bucket name
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', '--online', fixture.fullStackName('validate-online-conflicting')],
      {
        allowErrExit: true,
      },
    );

    expect(output).toContain('CloudFormation');
    expect(output).toContain('already exists');

    // Cleanup
    await fixture.cdk(['destroy', '--force', fixture.fullStackName('validate-online-deployed')]);
  }),
);
