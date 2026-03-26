import { deploysSuccessfully } from './testcase';
import { integTest, withCDKMigrateFixture, withRetry } from '../../../lib';

const language = 'java';

integTest(
  `cdk migrate ${language} deploys successfully`,
  withRetry(withCDKMigrateFixture(language, async (fixture) => {
    await deploysSuccessfully(fixture, language);
  })),
);
