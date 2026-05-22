import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate --no-online skips CloudFormation validation',
  withSpecificFixture('validate-online-app', async (fixture) => {
    // Deploy a stack that owns the bucket
    await fixture.cdk(
      ['deploy', '--require-approval=never', fixture.fullStackName('validate-online-deployed')],
    );

    // Validate with --no-online: the bucket name conflict should NOT be caught
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', '--no-online', fixture.fullStackName('validate-online-conflicting')],
      {
        allowErrExit: true,
      },
    );

    expect(output).not.toContain('already exists');
    expect(output).not.toContain('CloudFormation');

    // Cleanup
    await fixture.cdk(['destroy', '--force', fixture.fullStackName('validate-online-deployed')]);
  }),
);
