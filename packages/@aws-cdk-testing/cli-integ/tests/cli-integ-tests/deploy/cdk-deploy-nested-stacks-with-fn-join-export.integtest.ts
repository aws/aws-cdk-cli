import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'deploy nested stacks with Fn::Join export names',
  withSpecificFixture('nested-stack-with-fn-join-export', async (fixture) => {
    // This should succeed. IncludeNestedStacks:true is now set and CloudFormation
    // correctly handles Fn::Join export names in nested stacks (server-side fix).
    await fixture.cdkDeploy('nested-stacks-fn-join-export', { captureStderr: false });
  }),
);
