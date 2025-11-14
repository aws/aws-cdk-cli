import { deploysSuccessfully } from './testcase';
import { integTest, withCDKMigrateFixture, withRetry } from '../../../lib';

const language = 'java';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  `cdk migrate ${language} deploys successfully`,
  withRetry(withCDKMigrateFixture(language, async (fixture) => {
    await deploysSuccessfully(fixture, language);
  })),
);
