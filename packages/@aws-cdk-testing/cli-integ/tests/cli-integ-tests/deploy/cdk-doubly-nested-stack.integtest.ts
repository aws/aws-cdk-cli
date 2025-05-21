import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('doubly nested stack',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('with-doubly-nested-stack', {
      captureStderr: false,
    });
  }),
);

