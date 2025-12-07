import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy stack with multiple docker assets',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('multiple-docker-images', {
      options: ['--asset-parallelism', '--asset-build-concurrency', '3'],
    });
  }),
);
