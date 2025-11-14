import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff --fail on multiple stacks exits with error if any of the stacks contains a diff',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const diff1 = await fixture.cdk(['diff', fixture.fullStackName('test-1')]);
    expect(diff1).toContain('AWS::SNS::Topic');

    await fixture.cdkDeploy('test-2');
    const diff2 = await fixture.cdk(['diff', fixture.fullStackName('test-2')]);
    expect(diff2).toContain('There were no differences');

    // WHEN / THEN
    await expect(
      fixture.cdk(['diff', '--fail', fixture.fullStackName('test-1'), fixture.fullStackName('test-2')]),
    ).rejects.toThrow('exited with error');
  }),
);

