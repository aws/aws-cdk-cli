/* eslint-disable import/no-extraneous-dependencies */
import * as toolkit from '@aws-cdk/toolkit-lib';
import { approvalRecordingIoHost, assemblyFromCdkAppDir, hasParameterValueChange, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withSpecificFixture } from '../../lib';

/**
 * Regression test for the deploy side of https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * Adding a key to JSON built with an intrinsic is a change CloudFormation leaves out of a change set
 * described with IncludePropertyValues, without a warning. The diff that toolkit-lib sends with the
 * deploy approval request must contain it anyway.
 */
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
    await expect(tk.deploy(await assemblyFromCdkAppDir(tk, fixture, { VARIANT: 'add-key' }), {
      stacks,
      deploymentMethod: { method: 'change-set' },
    })).rejects.toThrow();

    // THEN - the diff sent with the approval request shows the parameter value as changed
    expect(approvals).toHaveLength(1);
    const diffs = Object.values(approvals[0].data.templateDiffs);
    expect(diffs.some(hasParameterValueChange)).toBe(true);
  }),
);
