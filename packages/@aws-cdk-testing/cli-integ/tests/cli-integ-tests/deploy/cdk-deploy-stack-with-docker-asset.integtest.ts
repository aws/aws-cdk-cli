import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy stack with docker asset',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('docker');
  }),
);

