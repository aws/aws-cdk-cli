import { deploysSuccessfully } from './testcase';
import { integTest, withCDKMigrateFixture } from '../../../lib';

const language = 'python';

integTest(
  `cdk migrate ${language} deploys successfully`,
  withCDKMigrateFixture(language, async (fixture) => {
    await deploysSuccessfully(fixture, language);
  }),
);
