/* eslint-disable import/no-extraneous-dependencies */
import * as toolkit from '@aws-cdk/toolkit-lib';
import { approvalRecordingIoHost, assemblyFromCdkAppDir, hasParameterValueChange, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withSpecificFixture } from '../../lib';

/**
 * A key is added to JSON built with an intrinsic in an SSM parameter in a nested stack.
 *
 * - Start: `{"stack":"<stack name>","a":"1"}`
 * - End: `{"stack":"<stack name>","a":"1","b":"2"}`
 * - Command: `toolkit.diff(cx, { method: DiffMethod.ChangeSet({ fallbackToTemplate: false }) })`
 * - Expected: the nested stack's diff has the parameter's `Value`
 *
 * Unlike the CLI, toolkit-lib reads the nested change sets. Described with IncludePropertyValues,
 * CloudFormation leaves this change out of the nested change set, without a warning
 * (https://github.com/aws/aws-cdk-cli/issues/2036).
 *
 * If CloudFormation stops leaving the change out, this test still passes; the unit tests are the
 * lasting coverage.
 */
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
