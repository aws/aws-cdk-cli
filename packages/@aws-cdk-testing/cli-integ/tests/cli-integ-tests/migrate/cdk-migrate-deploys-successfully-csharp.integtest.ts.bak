import { deploysSuccessfully } from './testcase';
import { integTest, withCDKMigrateFixture } from '../../../lib';

const language = 'csharp';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  `cdk migrate ${language} deploys successfully`,
  withCDKMigrateFixture(language, async (fixture) => {
    await deploysSuccessfully(fixture, language);
  }),
);
