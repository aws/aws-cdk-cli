/* eslint-disable import/no-extraneous-dependencies */
import * as toolkit from '@aws-cdk/toolkit-lib';
import { approvalRecordingIoHost, assemblyFromCdkAppDir, hasParameterValueChange, toolkitFromFixture } from './toolkit-helpers';
import { integTest, withSpecificFixture } from '../../lib';

/**
 * Companion to the nested regression test for https://github.com/aws/aws-cdk-cli/issues/2036
 *
 * Changing an existing value in JSON built with an intrinsic is a change CloudFormation lists even in a
 * change set described with IncludePropertyValues. The nested diff shows it with or without the recovery
 * for changes CloudFormation leaves out.
 */
integTest(
  'toolkit diff --method=change-set shows a changed value in JSON in a nested stack',
  withSpecificFixture('json-intrinsic-app', async (fixture) => {
    const stacks: toolkit.StackSelector = {
      strategy: toolkit.StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
      patterns: [fixture.fullStackName('json-intrinsic-nested')],
    };
    const tk = toolkitFromFixture(fixture, { ioHost: approvalRecordingIoHost(true).ioHost });

    // GIVEN - a deployed nested parameter holding {"stack":"<nested stack name>","a":"1"}
    await tk.deploy(await assemblyFromCdkAppDir(tk, fixture), { stacks });

    // WHEN - an existing value changes
    const result = await tk.diff(await assemblyFromCdkAppDir(tk, fixture, { VARIANT: 'change-value' }), {
      stacks,
      method: toolkit.DiffMethod.ChangeSet({ fallbackToTemplate: false }),
    });

    // THEN - the nested parameter value is shown as changed
    expect(Object.values(result).some(hasParameterValueChange)).toBe(true);
  }),
);
