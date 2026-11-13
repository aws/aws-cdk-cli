/* eslint-disable import/no-extraneous-dependencies */
import * as toolkit from '@aws-cdk/toolkit-lib';
import { approvalRecordingIoHost, assemblyFromCdkAppDir, hasParameterValueChange, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withSpecificFixture } from '../../lib';

integTest(
  'toolkit diff --method=change-set shows a key added to JSON in a nested stack',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stacks: toolkit.StackSelector = {
      strategy: toolkit.StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
      patterns: [fixture.fullStackName('json-intrinsic-nested')],
    };
    const tk = toolkitFromFixture(fixture, { ioHost: approvalRecordingIoHost(true).ioHost });

    // GIVEN - a deployed nested parameter holding {"stack":"<nested stack name>","a":"1"}
    await tk.deploy(await assemblyFromCdkAppDir(tk, fixture), { stacks });

    // WHEN - a key is added to the JSON
    const result = await tk.diff(await assemblyFromCdkAppDir(tk, fixture, { JSON_CHANGE: 'add-key' }), {
      stacks,
      method: toolkit.DiffMethod.ChangeSet({ fallbackToTemplate: false }),
    });

    // THEN - the nested parameter value is shown as changed
    expect(Object.values(result).some(hasParameterValueChange)).toBe(true);
  }),
);
