import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy same docker asset to multiple stacks',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy(['docker-multi-dest-1', 'docker-multi-dest-2']);
  }, {
    // This test pulls a public ECR image, so log in to avoid rate limits.
    setup: { ecrLogin: true },
  }),
);
