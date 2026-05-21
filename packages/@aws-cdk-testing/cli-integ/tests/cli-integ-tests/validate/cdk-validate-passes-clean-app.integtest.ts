import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate passes for clean app',
  withSpecificFixture('validate-passing-app', async (fixture) => {
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', fixture.fullStackName('validate-passing')],
    );

    expect(output).toContain('Policy validation passed. No violations found.');
  }),
);
