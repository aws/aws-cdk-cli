import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { multipleStacksWithoutSelectorMessage } from '../../../lib/api/cloud-assembly/private/stack-assembly';

function fakeStack(hierarchicalId: string): cxapi.CloudFormationStackArtifact {
  return { hierarchicalId } as cxapi.CloudFormationStackArtifact;
}

describe('multipleStacksWithoutSelectorMessage', () => {
  test('guides Stage users towards the wildcard pattern when stacks are nested in a Stage', () => {
    // GIVEN - all stacks live inside a Stage (no top-level stacks)
    const staged = [fakeStack('MyStage/StackA'), fakeStack('MyStage/StackB')];

    // WHEN
    const message = multipleStacksWithoutSelectorMessage([], staged);

    // THEN
    expect(message).toContain('Since this app includes more than a single stack');
    expect(message).toContain('Some of these stacks are nested inside a Stage');
    expect(message).toContain("'MyStage/*'");
  });

  test('deduplicates stage patterns across multiple stages', () => {
    // GIVEN
    const staged = [
      fakeStack('StageOne/StackA'),
      fakeStack('StageOne/StackB'),
      fakeStack('StageTwo/StackC'),
    ];

    // WHEN
    const message = multipleStacksWithoutSelectorMessage([], staged);

    // THEN
    expect(message).toContain("'StageOne/*'");
    expect(message).toContain("'StageTwo/*'");
    // `StageOne/*` should only appear once even though two stacks belong to it
    expect(message.match(/'StageOne\/\*'/g)).toHaveLength(1);
  });

  test('does not mention Stages for a flat app with only top-level stacks', () => {
    // GIVEN
    const topLevel = [fakeStack('StackA'), fakeStack('StackB')];

    // WHEN - top-level stacks are the same references as the full list
    const message = multipleStacksWithoutSelectorMessage(topLevel, topLevel);

    // THEN
    expect(message).toContain('Since this app includes more than a single stack');
    expect(message).not.toContain('Some of these stacks are nested inside a Stage');
  });
});
