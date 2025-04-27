import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'Stage with bundled Lambda function',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('bundling-stage/BundlingStack');
    fixture.log('Setup complete!');
    await fixture.cdkDestroy('bundling-stage/BundlingStack');
  }),
);

