import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff doesnt show resource metadata changes',
  withDefaultFixture(async (fixture) => {
    // GIVEN - small initial stack with default resource metadata
    await fixture.cdkDeploy('metadata');

    // WHEN - changing resource metadata value
    const diff = await fixture.cdk(['diff', fixture.fullStackName('metadata')], {
      verbose: true,
      modEnv: {
        INTEG_METADATA_VALUE: 'custom',
      },
    });

    // Assert there are no changes
    expect(diff).toContain('There were no differences');
  }),
);

