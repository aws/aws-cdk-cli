import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy all',
  withDefaultFixture(async (fixture) => {
    const arns = await fixture.cdkDeploy('test-*', { captureStderr: false });

    // verify that we only deployed both stacks (there are 2 ARNs in the output)
    expect(arns.split('\n').length).toEqual(2);
  }),
);

