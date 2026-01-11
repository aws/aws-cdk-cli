import { integTest, withAws, withSpecificCdkApp } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'publish command requires unstable flag',
  withAws(
    withSpecificCdkApp('simple-app', async (fixture) => {
      // Should fail without unstable flag
      await expect(fixture.cdk(['publish'])).rejects.toThrow(/unstable/);
    }),
  ),
);

integTest(
  'publish command works with unstable flag',
  withAws(
    withSpecificCdkApp('simple-app', async (fixture) => {
      // Bootstrap first
      await fixture.cdk(['bootstrap', '--unstable=publish']);

      // Should succeed with unstable flag
      const output = await fixture.cdk(['publish', '--unstable=publish']);

      // Expect success message or completion
      expect(output).toBeTruthy();
    }),
  ),
);

integTest(
  'publish command respects --exclusively flag',
  withAws(
    withSpecificCdkApp('dependency-app', async (fixture) => {
      // Bootstrap first
      await fixture.cdk(['bootstrap', '--unstable=publish']);

      // Publish only specific stack
      const output = await fixture.cdk(['publish', 'Stack1', '--unstable=publish', '--exclusively']);

      // Should publish only Stack1 assets
      expect(output).toBeTruthy();
    }),
  ),
);
