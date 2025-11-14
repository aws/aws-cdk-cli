import { fromStackCreatesDeployableApp } from './testcase';
import { integTest, withExtendedTimeoutFixture } from '../../../lib';

const language = 'python';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  `cdk migrate --from-stack creates deployable ${language} app`,
  withExtendedTimeoutFixture(async (fixture) => {
    await fromStackCreatesDeployableApp(fixture, language);
  }),
);
