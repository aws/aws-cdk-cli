import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate acknowledge suppresses warning',
  withSpecificFixture('validate-app', async (fixture) => {
    // Without acknowledgment, the annotation warning should appear
    const withWarning = await fixture.cdk(
      ['--unstable=validate', 'validate', fixture.fullStackName('validate')],
      {
        modEnv: { VALIDATION_SHOULD_FAIL: 'false', VALIDATION_ACKNOWLEDGE: 'false' },
        allowErrExit: true,
      },
    );

    expect(withWarning).toContain('This bucket has no lifecycle rules configured');

    // With acknowledgment, the annotation warning should be suppressed
    const acknowledged = await fixture.cdk(
      ['--unstable=validate', 'validate', fixture.fullStackName('validate')],
      {
        modEnv: { VALIDATION_SHOULD_FAIL: 'false', VALIDATION_ACKNOWLEDGE: 'true' },
      },
    );

    expect(acknowledged).not.toContain('This bucket has no lifecycle rules configured');
    expect(acknowledged).toContain('Policy validation passed. No violations found.');
  }),
);
