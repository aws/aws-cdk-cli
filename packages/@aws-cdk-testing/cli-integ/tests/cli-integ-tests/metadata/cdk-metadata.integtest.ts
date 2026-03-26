import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk metadata displays stack metadata',
  withDefaultFixture(async (fixture) => {
    await fixture.cdk(['synth', fixture.fullStackName('test-2')]);
    const output = await fixture.cdk(['metadata', fixture.fullStackName('test-2')]);

    // Most basic metadata type
    expect(output).toContain('aws:cdk:logicalId');
  }),
);
