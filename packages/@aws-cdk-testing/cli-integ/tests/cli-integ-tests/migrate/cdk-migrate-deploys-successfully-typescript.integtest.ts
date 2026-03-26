import { deploysSuccessfully } from './testcase';
import { integTest, withCDKMigrateFixture } from '../../../lib';

const language = 'typescript';

integTest(
  `cdk migrate ${language} deploys successfully`,
  withCDKMigrateFixture(language, async (fixture) => {
    await deploysSuccessfully(fixture, language);
  }),
);
