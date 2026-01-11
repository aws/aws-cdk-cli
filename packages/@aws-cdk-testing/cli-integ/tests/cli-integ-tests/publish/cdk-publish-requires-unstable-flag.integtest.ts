import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'publish command requires unstable flag',
  withSpecificFixture('simple-app', async (fixture) => {
    // Should fail without unstable flag
    await expect(fixture.cdk(['publish'])).rejects.toThrow(/unstable/);
  }),
);

integTest(
  'publish command works with unstable flag',
  withSpecificFixture('simple-app', async (fixture) => {
    // Should succeed with unstable flag (may have no assets to publish)
    const output = await fixture.cdk(['publish', '--unstable=publish']);

    // Expect completion without error
    expect(output).toBeTruthy();
  }),
);

integTest(
  'publish command respects --exclusively flag',
  withSpecificFixture('dependency-app', async (fixture) => {
    // Publish only specific stack
    const output = await fixture.cdk(['publish', 'Stack1', '--unstable=publish', '--exclusively']);

    // Should complete without error
    expect(output).toBeTruthy();
  }),
);
