import { integTest, withDefaultFixture } from '../../../lib';

integTest('doubly nested stack',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('with-doubly-nested-stack', {
      captureStderr: false,
    });
  }),
);

