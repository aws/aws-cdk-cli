import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy stack with multiple docker assets',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('multiple-docker-assets', {
      options: ['--asset-parallelism', '--asset-build-concurrency', '3'],
    });
  }, {
    // This test pulls a public ECR image, so log in to avoid rate limits.
    setup: { ecrLogin: true },
  }),
);
