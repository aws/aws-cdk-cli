import { integTest, withCliLibFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cli-lib list',
  withCliLibFixture(async (fixture) => {
    const listing = await fixture.cdk(['list'], { captureStderr: false });
    expect(listing).toContain(fixture.fullStackName('simple-1'));
  }),
);

