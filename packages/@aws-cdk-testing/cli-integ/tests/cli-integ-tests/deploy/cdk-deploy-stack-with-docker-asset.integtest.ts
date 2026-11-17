import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy stack with docker asset',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('docker');
  }, {
    // This test pulls a public ECR image, so log in to avoid rate limits.
    setup: { ecrLogin: true },
  }),
);

