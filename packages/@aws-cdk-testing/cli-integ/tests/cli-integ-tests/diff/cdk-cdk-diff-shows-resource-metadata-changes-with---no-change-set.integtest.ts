import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff shows resource metadata changes with --no-change-set',
  withDefaultFixture(async (fixture) => {
    // GIVEN - small initial stack with default resource metadata
    await fixture.cdkDeploy('metadata');

    // WHEN - changing resource metadata value
    const diff = await fixture.cdk(['diff --no-change-set', fixture.fullStackName('metadata')], {
      verbose: true,
      modEnv: {
        INTEG_METADATA_VALUE: 'custom',
      },
    });

    // Assert there are changes
    expect(diff).not.toContain('There were no differences');
  }),
);

