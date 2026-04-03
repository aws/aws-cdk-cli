import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'automatic ordering',
  withDefaultFixture(async (fixture) => {
    // Deploy the consuming stack which will include the producing stack
    await fixture.cdkDeploy('order-consuming');

    // Destroy the providing stack which will include the consuming stack
    await fixture.cdkDestroy('order-providing');
  }),
);

