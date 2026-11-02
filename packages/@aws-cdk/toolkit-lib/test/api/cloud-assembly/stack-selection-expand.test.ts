import { ExpandStackSelection, StackSelectionStrategy } from '../../../lib/api/cloud-assembly';
import { Toolkit } from '../../../lib/toolkit';
import { TestIoHost } from '../../_helpers';
import type { TestStackArtifact } from '../../_helpers/test-cloud-assembly-source';
import { TestCloudAssemblySource } from '../../_helpers/test-cloud-assembly-source';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });

beforeEach(() => {
  ioHost.notifySpy.mockClear();
});

// Regression test: a stack's hierarchicalId (used to key the internal
// selection maps) is `manifest.displayName ?? id`. When a stack has an
// explicit displayName that differs from its artifact id (as happens for
// stacks inside nested assemblies/stages), `includeDownstreamStacks` used
// to look up dependents by the dependency's raw `id` instead of its
// `hierarchicalId`, so it never found a match and silently failed to pull
// in downstream stacks - even though the symmetric `includeUpstreamStacks`
// correctly used hierarchicalId all along.
describe('downstream/upstream stack expansion with a non-trivial displayName', () => {
  const DEPENDENCY: TestStackArtifact = {
    stackName: 'DependencyStack',
    displayName: 'CustomDisplayName',
  };
  const DOWNSTREAM: TestStackArtifact = {
    stackName: 'DownstreamStack',
    depends: ['DependencyStack'],
  };

  test('DOWNSTREAM expansion pulls in a stack that depends on the selected stack', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [DEPENDENCY, DOWNSTREAM],
    });

    // WHEN: select only the dependency by its hierarchicalId (displayName), expand downstream
    const stacks = await toolkit.list(cx, {
      stacks: {
        patterns: ['CustomDisplayName'],
        strategy: StackSelectionStrategy.PATTERN_MATCH,
        expand: ExpandStackSelection.DOWNSTREAM,
      },
    });

    // THEN: the dependent stack must be included, not just the matched one
    expect(stacks.map(s => s.id).sort()).toEqual(['CustomDisplayName', 'DownstreamStack']);
  });

  test('UPSTREAM expansion pulls in the stack a selected stack depends on', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [DEPENDENCY, DOWNSTREAM],
    });

    // WHEN: select only the downstream stack, expand upstream
    const stacks = await toolkit.list(cx, {
      stacks: {
        patterns: ['DownstreamStack'],
        strategy: StackSelectionStrategy.PATTERN_MATCH,
        expand: ExpandStackSelection.UPSTREAM,
      },
    });

    // THEN: the dependency stack must be included
    expect(stacks.map(s => s.id).sort()).toEqual(['CustomDisplayName', 'DownstreamStack']);
  });
});
