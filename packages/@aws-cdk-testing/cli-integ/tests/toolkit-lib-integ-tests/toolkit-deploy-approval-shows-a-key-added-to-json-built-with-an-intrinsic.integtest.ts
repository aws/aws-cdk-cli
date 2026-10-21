/* eslint-disable import/no-extraneous-dependencies */
import * as toolkit from '@aws-cdk/toolkit-lib';
import { approvalRecordingIoHost, assemblyFromCdkAppDir, hasParameterValueChange, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withSpecificFixture } from '../../lib';

/**
 * A key is added to JSON built with an intrinsic in an SSM parameter, and the deploy approval is declined.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`
 * - Command: `toolkit.deploy(cx, { deploymentMethod: { method: 'change-set' } })`
 * - Expected: the diff in the approval request (`CDK_TOOLKIT_I5060` `templateDiffs`) has the parameter's `Value`
 *
 * Described with IncludePropertyValues, CloudFormation leaves this change out of the change set,
 * without a warning (https://github.com/aws/aws-cdk-cli/issues/2036). Tools that embed toolkit-lib get
 * the diff as data, so this checks the data rather than printed text.
 *
 * If CloudFormation stops leaving the change out, this test still passes; the unit tests are the
 * lasting coverage.
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
