import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'automatic ordering with concurrency',
  withDefaultFixture(async (fixture) => {
    // Deploy the consuming stack which will include the producing stack
    await fixture.cdkDeploy('order-consuming', { options: ['--concurrency', '2'] });

    // Destroy the providing stack which will include the consuming stack
    await fixture.cdkDestroy('order-providing');
  }),
);

