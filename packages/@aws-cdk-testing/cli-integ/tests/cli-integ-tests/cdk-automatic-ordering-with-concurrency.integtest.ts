import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'automatic ordering with concurrency',
  withDefaultFixture(async (fixture) => {
    // Deploy the consuming stack which will include the producing stack
    await fixture.cdkDeploy('order-consuming', { options: ['--concurrency', '2'] });

    // Destroy the providing stack which will include the consuming stack
    await fixture.cdkDestroy('order-providing');
  }),
);

