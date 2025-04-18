import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk synth',
  withDefaultFixture(async (fixture) => {
    await fixture.cdk(['synth', fixture.fullStackName('test-1')]);
    expect(fixture.template('test-1')).toEqual(
      expect.objectContaining({
        Resources: {
          topic69831491: {
            Type: 'AWS::SNS::Topic',
            Metadata: {
              'aws:cdk:path': `${fixture.stackNamePrefix}-test-1/topic/Resource`,
            },
          },
        },
      }),
    );

    expect(
      await fixture.cdkSynth({
        options: [fixture.fullStackName('test-1')],
      }),
    ).not.toEqual(
      expect.stringContaining(`
Rules:
  CheckBootstrapVersion:`),
    );

    await fixture.cdk(['synth', fixture.fullStackName('test-2')], { verbose: false });
    expect(fixture.template('test-2')).toEqual(
      expect.objectContaining({
        Resources: {
          topic152D84A37: {
            Type: 'AWS::SNS::Topic',
            Metadata: {
              'aws:cdk:path': `${fixture.stackNamePrefix}-test-2/topic1/Resource`,
            },
          },
          topic2A4FB547F: {
            Type: 'AWS::SNS::Topic',
            Metadata: {
              'aws:cdk:path': `${fixture.stackNamePrefix}-test-2/topic2/Resource`,
            },
          },
        },
      }),
    );
  }),
);

