import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'docker-credential-cdk-assets can be invoked as a binary',
  withDefaultFixture(async (fixture) => {
    await fixture.shell(['npm', 'init', '-y']);
    await fixture.shell(['npm', 'install', 'cdk-assets@latest']);

    await fixture.shell(['node', './node_modules/cdk-assets/bin/docker-credential-cdk-assets', 'get'])

  }),
);
