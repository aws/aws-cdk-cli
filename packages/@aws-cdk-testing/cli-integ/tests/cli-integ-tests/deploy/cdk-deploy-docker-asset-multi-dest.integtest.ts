import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy same docker asset to multiple stacks',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy(['docker-multi-dest-1', 'docker-multi-dest-2']);
  }),
);
