import { integTest, withoutBootstrap } from '../../../lib';

integTest('can use the default permissions boundary to bootstrap', withoutBootstrap(async (fixture) => {
  let template = await fixture.cdkBootstrapModern({
    // toolkitStackName doesn't matter for this particular invocation
    toolkitStackName: fixture.bootstrapStackName,
    showTemplate: true,
    examplePermissionsBoundary: true,
  });

  expect(template).toContain('PermissionsBoundary');
}));

