import { integTest, withoutBootstrap } from '../../../lib';

integTest('can use the custom permissions boundary to bootstrap', withoutBootstrap(async (fixture) => {
  let template = await fixture.cdkBootstrapModern({
    // toolkitStackName doesn't matter for this particular invocation
    toolkitStackName: fixture.bootstrapStackName,
    showTemplate: true,
    customPermissionsBoundary: 'permission-boundary-name',
  });

  expect(template).toContain('permission-boundary-name');
}));

