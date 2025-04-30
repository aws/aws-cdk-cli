import type * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import { minimatch } from 'minimatch';
import { StackCollection } from './stack-collection';
import { flatten } from '../../util';
import { IO } from '../io/private';
import type { IoHelper } from '../io/private/io-helper';

export interface IStackAssembly {
  /**
   * The directory this CloudAssembly was read from
   */
  directory: string;

  /**
   * Select a single stack by its ID
   */
  stackById(stackId: string): StackCollection;
}

/**
 * When selecting stacks, what other stacks to include because of dependencies
 */
export enum ExtendedStackSelection {
  /**
   * Don't select any extra stacks
   */
  None,

  /**
   * Include stacks that this stack depends on
   */
  Upstream,

  /**
   * Include stacks that depend on this stack
   */
  Downstream,
}

/**
 * A single Cloud Assembly and the operations we do on it to deploy the artifacts inside
 */
export abstract class BaseStackAssembly implements IStackAssembly {
  /**
   * Sanitize a list of stack match patterns
   */
  protected static sanitizePatterns(patterns: string[]): string[] {
    let sanitized = patterns.filter(s => s != null); // filter null/undefined
    sanitized = [...new Set(sanitized)]; // make them unique
    return sanitized;
  }

  /**
   * The directory this CloudAssembly was read from
   */
  public readonly directory: string;

  /**
   * The IoHelper used for messaging
   */
  protected readonly ioHelper: IoHelper;

  constructor(public readonly assembly: cxapi.CloudAssembly, ioHelper: IoHelper) {
    this.directory = assembly.directory;
    this.ioHelper = ioHelper;
  }

  /**
   * Select a single stack by its ID
   */
  public stackById(stackId: string) {
    return new StackCollection(this, [this.assembly.getStackArtifact(stackId)]);
  }

  protected async selectMatchingStacks(
    stacks: cxapi.CloudFormationStackArtifact[],
    patterns: string[],
    extend: ExtendedStackSelection = ExtendedStackSelection.None,
  ): Promise<StackCollection> {
    const matchingPattern = (pattern: string) => (stack: cxapi.CloudFormationStackArtifact) => minimatch(stack.hierarchicalId, pattern);
    const matchedStacks = flatten(patterns.map(pattern => stacks.filter(matchingPattern(pattern))));

    return this.extendStacks(matchedStacks, stacks, extend);
  }

  protected async extendStacks(
    matched: cxapi.CloudFormationStackArtifact[],
    all: cxapi.CloudFormationStackArtifact[],
    extend: ExtendedStackSelection = ExtendedStackSelection.None,
  ) {
    const allStacks = new Map<string, cxapi.CloudFormationStackArtifact>();
    for (const stack of all) {
      allStacks.set(stack.hierarchicalId, stack);
    }

    const index = indexByHierarchicalId(matched);

    switch (extend) {
      case ExtendedStackSelection.Downstream:
        await includeDownstreamStacks(this.ioHelper, index, allStacks);
        break;
      case ExtendedStackSelection.Upstream:
        await includeUpstreamStacks(this.ioHelper, index, allStacks);
        break;
    }

    // Filter original array because it is in the right order
    const selectedList = all.filter(s => index.has(s.hierarchicalId));

    return new StackCollection(this, selectedList);
  }
}

function indexByHierarchicalId(stacks: cxapi.CloudFormationStackArtifact[]): Map<string, cxapi.CloudFormationStackArtifact> {
  const result = new Map<string, cxapi.CloudFormationStackArtifact>();

  for (const stack of stacks) {
    result.set(stack.hierarchicalId, stack);
  }

  return result;
}

/**
 * Calculate the transitive closure of stack dependents.
 *
 * Modifies `selectedStacks` in-place.
 */
async function includeDownstreamStacks(
  ioHelper: IoHelper,
  selectedStacks: Map<string, cxapi.CloudFormationStackArtifact>,
  allStacks: Map<string, cxapi.CloudFormationStackArtifact>,
) {
  const added = new Array<string>();

  let madeProgress;
  do {
    madeProgress = false;

    for (const [id, stack] of allStacks) {
      // Select this stack if it's not selected yet AND it depends on a stack that's in the selected set
      if (!selectedStacks.has(id) && (stack.dependencies || []).some(dep => selectedStacks.has(dep.id))) {
        selectedStacks.set(id, stack);
        added.push(id);
        madeProgress = true;
      }
    }
  } while (madeProgress);

  if (added.length > 0) {
    await ioHelper.notify(IO.DEFAULT_ASSEMBLY_INFO.msg(`Including depending stacks: ${chalk.bold(added.join(', '))}`));
  }
}

/**
 * Calculate the transitive closure of stack dependencies.
 *
 * Modifies `selectedStacks` in-place.
 */
async function includeUpstreamStacks(
  ioHelper: IoHelper,
  selectedStacks: Map<string, cxapi.CloudFormationStackArtifact>,
  allStacks: Map<string, cxapi.CloudFormationStackArtifact>,
) {
  const added = new Array<string>();
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;

    for (const stack of selectedStacks.values()) {
      // Select an additional stack if it's not selected yet and a dependency of a selected stack (and exists, obviously)
      for (const dependencyId of stack.dependencies.map(x => x.manifest.displayName ?? x.id)) {
        if (!selectedStacks.has(dependencyId) && allStacks.has(dependencyId)) {
          added.push(dependencyId);
          selectedStacks.set(dependencyId, allStacks.get(dependencyId)!);
          madeProgress = true;
        }
      }
    }
  }

  if (added.length > 0) {
    await ioHelper.notify(IO.DEFAULT_ASSEMBLY_INFO.msg(`Including dependency stacks: ${chalk.bold(added.join(', '))}`));
  }
}
