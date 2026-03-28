import { fromStackCreatesDeployableApp } from './testcase';
import { integTest, withExtendedTimeoutFixture } from '../../../lib';

const language = 'python';

integTest(
  `cdk migrate --from-stack creates deployable ${language} app`,
  withExtendedTimeoutFixture(async (fixture) => {
    await fromStackCreatesDeployableApp(fixture, language);
  }),
);
