import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate reports violations',
  withSpecificFixture('validate-app', async (fixture) => {
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', fixture.fullStackName('validate')],
      {
        modEnv: { VALIDATION_SHOULD_FAIL: 'true', VALIDATION_ACKNOWLEDGE: 'false' },
        allowErrExit: true,
      },
    );

    // SecurityPlugin violations
    expect(output).toContain('S3 Buckets must not be publicly accessible');
    expect(output).toContain('S3 Buckets must have server-side encryption enabled');
    expect(output).toContain('S3 Buckets should have versioning enabled for data protection');
    expect(output).toContain('SecurityPlugin');

    // Construct Annotations plugin picks up the addWarning
    expect(output).toContain('This bucket has no lifecycle rules configured');
    expect(output).toContain('Construct Annotations');
  }),
);
