import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk ls',
  withDefaultFixture(async (fixture) => {
    const listing = await fixture.cdk(['ls'], { captureStderr: false });

    const expectedStacks = [
      'conditional-resource',
      'docker',
      'docker-with-custom-file',
      'failed',
      'iam-test',
      'lambda',
      'missing-ssm-parameter',
      'order-providing',
      'outputs-test-1',
      'outputs-test-2',
      'param-test-1',
      'param-test-2',
      'param-test-3',
      'termination-protection',
      'test-1',
      'test-2',
      'with-nested-stack',
      'with-nested-stack-using-parameters',
      'order-consuming',
    ];

    for (const stack of expectedStacks) {
      expect(listing).toContain(fixture.fullStackName(stack));
    }
  }),
);
