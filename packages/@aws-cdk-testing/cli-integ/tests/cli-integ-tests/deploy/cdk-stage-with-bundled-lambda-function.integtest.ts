import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'Stage with bundled Lambda function',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('bundling-stage/BundlingStack');
    fixture.log('Setup complete!');
  }),
);

