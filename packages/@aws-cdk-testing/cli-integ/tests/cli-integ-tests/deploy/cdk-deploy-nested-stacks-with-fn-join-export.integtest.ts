import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'deploy nested stacks with Fn::Join export names',
  withSpecificFixture('nested-stack-with-fn-join-export', async (fixture) => {
    // This should succeed. With IncludeNestedStacks:true, CloudFormation
    // incorrectly reports duplicate export names when multiple nested stacks
    // use Fn::Join with the same runtime reference to build export names.
    await fixture.cdkDeploy('nested-stacks-fn-join-export', { captureStderr: false });
  }),
);
