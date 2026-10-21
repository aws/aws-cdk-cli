/* eslint-disable import/no-extraneous-dependencies */
import * as toolkit from '@aws-cdk/toolkit-lib';
import { approvalRecordingIoHost, assemblyFromCdkAppDir, hasParameterValueChange, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withSpecificFixture } from '../../lib';

integTest(
  'toolkit deploy approval shows a key added to JSON built with an intrinsic',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stacks: toolkit.StackSelector = {
      strategy: toolkit.StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
      patterns: [fixture.fullStackName('json-intrinsic')],
    };

    const approving = toolkitFromFixture(fixture, { ioHost: approvalRecordingIoHost(true).ioHost });

    // GIVEN - a deployed parameter holding {"stack":"<stack name>","a":"1"}
    await approving.deploy(await assemblyFromCdkAppDir(approving, fixture), { stacks });

    // WHEN - a key is added, and the deploy approval is declined
    const { ioHost, approvals } = approvalRecordingIoHost(false);
    const tk = toolkitFromFixture(fixture, { ioHost });
    await expect(tk.deploy(await assemblyFromCdkAppDir(tk, fixture, { JSON_CHANGE: 'add-key' }), {
      stacks,
      deploymentMethod: { method: 'change-set' },
    })).rejects.toThrow();

    // THEN - the diff sent with the approval request shows the parameter value as changed
    expect(approvals).toHaveLength(1);
    const diffs = Object.values(approvals[0].data.templateDiffs);
    expect(diffs.some(hasParameterValueChange)).toBe(true);
  }),
);
