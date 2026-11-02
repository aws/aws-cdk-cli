import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'ci output to stderr',
  withDefaultFixture(async (fixture) => {
    const deployOutput = await fixture.cdkDeploy('test-2', { captureStderr: true, onlyStderr: true });
    const diffOutput = await fixture.cdk(['diff', fixture.fullStackName('test-2')], {
      captureStderr: true,
      onlyStderr: true,
    });
    const destroyOutput = await fixture.cdkDestroy('test-2', { captureStderr: true, onlyStderr: true });
    expect(deployOutput).not.toEqual('');
    expect(destroyOutput).not.toEqual('');
    expect(diffOutput).not.toEqual('');
  }),
);

