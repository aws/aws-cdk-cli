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

// Patterns used to be matched independently and unioned, so `['!A', '!B']`
// contributed "not A" and "not B" and returned every stack there is.

const STACKS: TestStackArtifact[] = [
  { stackName: 'StackA', displayName: 'Prod/StackA' },
  { stackName: 'StackB', displayName: 'Prod/StackB' },
  { stackName: 'Canary', displayName: 'Prod/Canary' },
  { stackName: 'DevStack', displayName: 'Dev/DevStack' },
];

async function select(patterns: string[], expand = ExpandStackSelection.NONE) {
  const cx = new TestCloudAssemblySource({ stacks: STACKS });
  const stacks = await toolkit.list(cx, {
    stacks: { patterns, strategy: StackSelectionStrategy.PATTERN_MATCH, expand },
  });
  return stacks.map(s => s.id).sort();
}

describe('exclusion patterns', () => {
  test('a single exclusion selects everything else', async () => {
    expect(await select(['!Prod/StackB'])).toEqual(['Dev/DevStack', 'Prod/Canary', 'Prod/StackA']);
  });

  test('multiple exclusions remove all of the stacks they match', async () => {
    // Used to return every stack, including the two that were excluded
    expect(await select(['!Prod/StackB', '!Prod/Canary'])).toEqual(['Dev/DevStack', 'Prod/StackA']);
  });

  test('an exclusion narrows down the stacks matched by the other patterns', async () => {
    // Used to return every stack but Canary, because 'Prod/StackA' and
    // '!Prod/Canary' were unioned instead of subtracted
    expect(await select(['Prod/StackA', '!Prod/Canary'])).toEqual(['Prod/StackA']);
  });

  test('`!(...)` is extglob syntax, not an exclusion', async () => {
    // Taken as an exclusion, `!(StackA)` would leave `(StackA)` to exclude and
    // select `Prod/StackA` too. As an extglob it does not cross a `/`.
    const cx = new TestCloudAssemblySource({
      stacks: [{ stackName: 'StackA' }, { stackName: 'StackB' }, { stackName: 'Nested', displayName: 'Prod/StackA' }],
    });
    const stacks = await toolkit.list(cx, {
      stacks: { patterns: ['!(StackA)'], strategy: StackSelectionStrategy.PATTERN_MATCH, expand: ExpandStackSelection.NONE },
    });

    expect(stacks.map(s => s.id).sort()).toEqual(['StackB']);
  });

  test('a doubled `!` cancels out, the way picomatch reads it', async () => {
    // Not an exclusion: picomatch matches `!!Prod/StackA` as a positive
    expect(await select(['!!Prod/StackA'])).toEqual(['Prod/StackA']);
  });

  test('patterns without an exclusion are unaffected', async () => {
    expect(await select(['Prod/StackA', 'Dev/*'])).toEqual(['Dev/DevStack', 'Prod/StackA']);
  });

  test('an empty pattern list still selects nothing', async () => {
    expect(await select([])).toEqual([]);
  });
});

describe('exclusion patterns and dependency expansion', () => {
  const DEPENDENCY: TestStackArtifact = { stackName: 'DependencyStack' };
  const DEPENDENT: TestStackArtifact = { stackName: 'DependentStack', depends: ['DependencyStack'] };

  test('an excluded stack is still pulled back in as a dependency', async () => {
    // Deploying the dependent stack without its dependency is not something the
    // toolkit can do, so expansion wins over the exclusion. `--exclusively`
    // (ExpandStackSelection.NONE) is how you keep the dependency out.
    const cx = new TestCloudAssemblySource({ stacks: [DEPENDENCY, DEPENDENT] });
    const stacks = await toolkit.list(cx, {
      stacks: {
        patterns: ['DependentStack', '!DependencyStack'],
        strategy: StackSelectionStrategy.PATTERN_MATCH,
        expand: ExpandStackSelection.UPSTREAM,
      },
    });

    expect(stacks.map(s => s.id).sort()).toEqual(['DependencyStack', 'DependentStack']);
  });

  test('without expansion the exclusion holds', async () => {
    const cx = new TestCloudAssemblySource({ stacks: [DEPENDENCY, DEPENDENT] });
    const stacks = await toolkit.list(cx, {
      stacks: {
        patterns: ['DependentStack', '!DependencyStack'],
        strategy: StackSelectionStrategy.PATTERN_MATCH,
        expand: ExpandStackSelection.NONE,
      },
    });

    expect(stacks.map(s => s.id).sort()).toEqual(['DependentStack']);
  });
});
