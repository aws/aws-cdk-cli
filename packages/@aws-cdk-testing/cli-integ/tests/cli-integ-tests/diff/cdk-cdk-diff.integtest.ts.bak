import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff',
  withDefaultFixture(async (fixture) => {
    const diff1 = await fixture.cdk(['diff', fixture.fullStackName('test-1')]);
    expect(diff1).toContain('AWS::SNS::Topic');

    const diff2 = await fixture.cdk(['diff', fixture.fullStackName('test-2')]);
    expect(diff2).toContain('AWS::SNS::Topic');

    // We can make it fail by passing --fail
    await expect(fixture.cdk(['diff', '--fail', fixture.fullStackName('test-1')])).rejects.toThrow('exited with error');
  }),
);

