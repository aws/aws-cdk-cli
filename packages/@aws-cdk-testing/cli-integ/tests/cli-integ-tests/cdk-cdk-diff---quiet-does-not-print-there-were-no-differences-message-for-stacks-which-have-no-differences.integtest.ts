import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  "cdk diff --quiet does not print 'There were no differences' message for stacks which have no differences",
  withDefaultFixture(async (fixture) => {
    // GIVEN
    await fixture.cdkDeploy('test-1');

    // WHEN
    const diff = await fixture.cdk(['diff', '--quiet', fixture.fullStackName('test-1')]);

    // THEN
    expect(diff).not.toContain('Stack test-1');
    expect(diff).not.toContain('There were no differences');
  }),
);

