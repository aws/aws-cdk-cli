import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate --online passes for valid template',
  withSpecificFixture('validate-online-app', async (fixture) => {
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', '--online', fixture.fullStackName('validate-online-valid')],
    );

    expect(output).toContain('No violations found');
  }),
);
