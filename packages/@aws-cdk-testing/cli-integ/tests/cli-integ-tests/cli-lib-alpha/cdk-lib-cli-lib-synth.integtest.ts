import { integTest, withCliLibFixture, withRetry } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cli-lib synth',
  withRetry(withCliLibFixture(async (fixture) => {
    await fixture.cdk(['synth', fixture.fullStackName('simple-1')]);
    expect(fixture.template('simple-1')).toEqual(
      expect.objectContaining({
        // Checking for a small subset is enough as proof that synth worked
        Resources: expect.objectContaining({
          queue276F7297: expect.objectContaining({
            Type: 'AWS::SQS::Queue',
            Properties: {
              VisibilityTimeout: 300,
            },
            Metadata: {
              'aws:cdk:path': `${fixture.stackNamePrefix}-simple-1/queue/Resource`,
            },
          }),
        }),
      }),
    );
  })),
);

