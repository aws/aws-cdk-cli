import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy all concurrently',
  withDefaultFixture(async (fixture) => {
    const arns = await fixture.cdkDeploy('test-*', {
      captureStderr: false,
      options: ['--concurrency', '2'],
    });

    // verify that we only deployed both stacks (there are 2 ARNs in the output)
    expect(arns.split('\n').length).toEqual(2);
  }),
);

