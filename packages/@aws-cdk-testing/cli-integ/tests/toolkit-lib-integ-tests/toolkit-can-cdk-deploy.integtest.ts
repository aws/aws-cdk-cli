/* eslint-disable import/no-extraneous-dependencies */
import * as toolkit from '@aws-cdk/toolkit-lib';
import { assemblyFromCdkAppDir, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withDefaultFixture } from '../../lib';

integTest(
  'toolkit can cdk deploy',
  withDefaultFixture(async (fixture) => {
    const tk = toolkitFromFixture(fixture);

    const assembly = await assemblyFromCdkAppDir(tk, fixture);

    const stacks: toolkit.StackSelector = {
      strategy: toolkit.StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
      patterns: [fixture.fullStackName('test-1')],
    };

    await tk.deploy(assembly, { stacks });
    await tk.destroy(assembly, { stacks });
  }),
);
