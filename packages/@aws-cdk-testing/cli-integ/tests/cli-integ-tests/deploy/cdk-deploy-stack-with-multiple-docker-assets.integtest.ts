import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy stack with multiple docker assets',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('multiple-docker-assets', {
      options: ['--asset-parallelism', '--asset-build-concurrency', '3'],
    });
  }),
);
