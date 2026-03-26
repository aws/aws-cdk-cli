import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'failed deploy does not hang',
  withDefaultFixture(async (fixture) => {
    // this will hang if we introduce https://github.com/aws/aws-cdk/issues/6403 again.
    await expect(fixture.cdkDeploy('failed')).rejects.toThrow('exited with error');
  }),
);

