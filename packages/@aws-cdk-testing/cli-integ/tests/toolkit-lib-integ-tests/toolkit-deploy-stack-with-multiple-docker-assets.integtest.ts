/* eslint-disable import/no-extraneous-dependencies */
import * as toolkit from '@aws-cdk/toolkit-lib';
import { assemblyFromCdkAppDir, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withDefaultFixture } from '../../lib';

integTest(
  'toolkit deploy stack with multiple docker assets',
  withDefaultFixture(async (fixture) => {
    const tk = toolkitFromFixture(fixture);

    const assembly = await assemblyFromCdkAppDir(tk, fixture);

    const stacks: toolkit.StackSelector = {
      strategy: toolkit.StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
      patterns: [fixture.fullStackName('multiple-docker-assets')],
    };

    await tk.deploy(assembly, {
      stacks,
      assetParallelism: true,
      assetBuildConcurrency: 3,
    });
    await tk.destroy(assembly, { stacks });
  }),
);
