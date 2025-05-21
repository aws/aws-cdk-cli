import { integTest, withSamIntegrationFixture, randomInteger } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'sam can locally test the synthesized cdk application',
  withSamIntegrationFixture(async (fixture) => {
    // Synth first
    await fixture.cdkSynth();

    const result = await fixture.samLocalStartApi(
      'TestStack',
      false,
      randomInteger(30000, 40000),
      '/restapis/spec/pythonFunction',
    );
    expect(result.actionSucceeded).toBeTruthy();
    expect(result.actionOutput).toEqual(
      expect.objectContaining({
        message: 'Hello World',
      }),
    );
  }),
);

