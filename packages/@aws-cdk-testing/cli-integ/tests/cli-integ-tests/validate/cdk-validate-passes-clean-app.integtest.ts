import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate passes for clean app',
  withSpecificFixture('validate-app', async (fixture) => {
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', fixture.fullStackName('validate')],
      {
        modEnv: { VALIDATION_SHOULD_FAIL: 'false' },
      },
    );

    expect(output).toContain('Policy validation passed. No violations found.');
  }),
);
