import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk notices with --unacknowledged',
  withDefaultFixture(async (fixture) => {
    const noticesUnacknowledged = await fixture.cdk(['notices', '--unacknowledged'], { verbose: false });
    const noticesUnacknowledgedAlias = await fixture.cdk(['notices', '-u'], { verbose: false });
    expect(noticesUnacknowledged).toEqual(expect.stringMatching(/There are \d{1,} unacknowledged notice\(s\)./));
    expect(noticesUnacknowledged).toEqual(noticesUnacknowledgedAlias);
  }),
);

