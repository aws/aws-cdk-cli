import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy stack with docker asset',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('docker');
  }),
);

