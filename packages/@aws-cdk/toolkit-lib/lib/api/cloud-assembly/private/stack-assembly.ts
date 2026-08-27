import '../../../private/dispose-polyfill';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import chalk from 'chalk';
import { isMatch as picomatch } from 'picomatch';
import { major } from 'semver';
import { ToolkitError } from '../../../toolkit/toolkit-error';
import { flatten } from '../../../util';
import type { IoHelper } from '../../io/private';
import { IO } from '../../io/private';
import { StackCollection } from '../stack-collection';
import type { StackSelector } from '../stack-selector';
import { ExpandStackSelection, StackSelectionStrategy } from '../stack-selector';
import type { IReadableCloudAssembly } from '../types';

/**
 * Options for `StackAssembly.selectStacksV3`.
 */
export interface SelectStacksV3Options {
  /**
   * For a pattern selector, also compute suggestions for every pattern that
   * matched no stack (see `SelectStacksV3Result.suggestions`).
   *
   * @default false
   */
  readonly suggestPatternMatches?: boolean;
}

/**
 * Result of `StackAssembly.selectStacksV3`.
 */
export interface SelectStacksV3Result {
  /**
   * The selected stacks.
   */
  readonly stacks: StackCollection;

  /**
   * Only present when `suggestPatternMatches` was requested and the selector is
   * a pattern selector: for every provided pattern that matched no stack, the
   * hierarchical ids of stacks that loosely (case-insensitively) resemble it.
   * The array is empty when there is no close match. Patterns that matched at
   * least one stack do not appear.
   */
  readonly suggestions?: Record<string, string[]>;
}

/**
 * A single Cloud Assembly wrapped to provide additional stack operations.
 */
export class StackAssembly implements IReadableCloudAssembly {
  /**
   * Sanitize a list of stack match patterns
   */
  private static sanitizePatterns(patterns: string[]): string[] {
    let sanitized = patterns.filter(s => s != null); // filter null/undefined
    sanitized = [...new Set(sanitized)]; // make them unique
    return sanitized;
  }

  /**
   * Cache of all artifacts in this assembly
   */
  private _allStacks: cxapi.CloudFormationStackArtifact[] | undefined;

  /**
   * The directory this CloudAssembly was read from
   */
  public readonly directory: string;

  /**
   * The wrapped Cloud Assembly
   */
  public readonly assembly: cxapi.CloudAssembly;

  /**
   * The IoHelper used for messaging
   */
  private readonly ioHelper: IoHelper;

  constructor(private readonly _asm: IReadableCloudAssembly, ioHelper: IoHelper) {
    this.assembly = _asm.cloudAssembly;
    this.directory = _asm.cloudAssembly.directory;
    this.ioHelper = ioHelper;
  }

  public get cloudAssembly() {
    return this._asm.cloudAssembly;
  }

  public async _unlock() {
    return this._asm._unlock();
  }

  public async dispose() {
    return this._asm.dispose();
  }

  public async [Symbol.asyncDispose]() {
    return this.dispose();
  }

  /**
   * Cached get the fetch all CloudFormationStackArtifacts for the assembly.
   */
  private get allStacks(): cxapi.CloudFormationStackArtifact[] {
    if (!this._allStacks) {
      this._allStacks = major(this.assembly.version) < 10 ? this.assembly.stacks : this.assembly.stacksRecursively;
    }

    return this._allStacks;
  }

  /**
   * Select a single stack by its ID
   */
  public stackById(stackId: string) {
    return new StackCollection(this, [this.assembly.getStackArtifact(stackId)]);
  }

  /**
   * Improved stack selection interface with a single selector
   * @throws when the assembly does not contain any stacks, unless `selector.failOnEmpty` is `false`
   * @throws when individual selection strategies are not satisfied
   *
   * Thin wrapper around `selectStacksV3` that keeps the historic return shape.
   */
  public async selectStacksV2(selector: StackSelector): Promise<StackCollection> {
    return (await this.selectStacksV3(selector)).stacks;
  }

  /**
   * Improved stack selection interface with a single selector, optionally
   * reporting suggestions for patterns that matched no stack.
   *
   * @throws when the assembly does not contain any stacks, unless `selector.failOnEmpty` is `false`
   * @throws when individual selection strategies are not satisfied
   */
  public async selectStacksV3(selector: StackSelector, options: SelectStacksV3Options = {}): Promise<SelectStacksV3Result> {
    const asm = this.assembly;
    const topLevelStacks = asm.stacks;
    const allStacks = this.allStacks;

    if (allStacks.length === 0) {
      if (selector.failOnEmpty ?? true) {
        throw new ToolkitError('NoStacksInApp', 'This app contains no stacks');
      }
      // Halt execution for empty assemblies without error, regardless of strategy
      return { stacks: new StackCollection(this, []) };
    }

    const extend = selector.expand;
    const patterns = StackAssembly.sanitizePatterns(selector.patterns ?? []);

    switch (selector.strategy) {
      case StackSelectionStrategy.ALL_STACKS:
        return { stacks: new StackCollection(this, allStacks) };
      case StackSelectionStrategy.MAIN_ASSEMBLY:
        if (topLevelStacks.length < 1) {
          // @todo text should probably be handled in io host
          throw new ToolkitError('NoStackInMainAssembly', 'No stack found in the main cloud assembly. Use "list" to print manifest');
        }
        return { stacks: await this.extendStacks(topLevelStacks, allStacks, extend) };
      case StackSelectionStrategy.ONLY_SINGLE:
        if (topLevelStacks.length !== 1) {
          // @todo text should probably be handled in io host
          throw new ToolkitError('MultipleStacksWithoutSelector', multipleStacksWithoutSelectorMessage(topLevelStacks, allStacks));
        }
        return { stacks: new StackCollection(this, topLevelStacks) };
      default:
        const matched = await this.selectMatchingStacks(allStacks, patterns, extend);
        if (
          selector.strategy === StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE
          && matched.stackCount !== 1
        ) {
          // @todo text should probably be handled in io host
          throw new ToolkitError(
            'AmbiguousStackSelection',
            `Stack selection is ambiguous, please choose a specific stack for import [${allStacks.map(x => x.hierarchicalId).join(',')}]`,
          );
        }
        if (
          selector.strategy === StackSelectionStrategy.PATTERN_MUST_MATCH
          && matched.stackCount < 1
        ) {
          // @todo text should probably be handled in io host
          throw new ToolkitError(
            'NoStacksMatched',
            `No stacks match the name(s) ${patterns}`,
          );
        }

        return {
          stacks: matched,
          suggestions: options.suggestPatternMatches ? this.suggestionsForPatterns(patterns, matched) : undefined,
        };
    }
  }

  /**
   * For every pattern that matched no stack, collect the hierarchical ids of
   * stacks that loosely (case-insensitively) resemble it. Patterns that matched
   * at least one stack are omitted; the array is empty when there is no close
   * match. Pure computation, never throws, emits no output.
   */
  private suggestionsForPatterns(patterns: string[], matched: StackCollection): Record<string, string[]> {
    const suggestions: Record<string, string[]> = {};
    for (const pattern of patterns) {
      if (matched.stackArtifacts.some((stack) => picomatch(stack.hierarchicalId, pattern))) {
        continue;
      }
      suggestions[pattern] = this.allStacks
        .filter((stack) => picomatch(stack.hierarchicalId.toLowerCase(), pattern.toLowerCase()))
        .map((stack) => stack.hierarchicalId);
    }
    return suggestions;
  }

  /**
   * Select all stacks that have the validateOnSynth flag et.
   *
   * @returns a `StackCollection` of all stacks that needs to be validated
   */
  public selectStacksForValidation() {
    const selected = this.allStacks.filter((art) => art.validateOnSynth ?? false);
    return new StackCollection(this, selected);
  }

  private async selectMatchingStacks(
    stacks: cxapi.CloudFormationStackArtifact[],
    patterns: string[],
    extend: ExpandStackSelection = ExpandStackSelection.NONE,
  ): Promise<StackCollection> {
    const matchingPattern = (pattern: string) => (stack: cxapi.CloudFormationStackArtifact) => picomatch(stack.hierarchicalId, pattern);
    const matchedStacks = flatten(patterns.map(pattern => stacks.filter(matchingPattern(pattern))));

    return this.extendStacks(matchedStacks, stacks, extend);
  }

  private async extendStacks(
    matched: cxapi.CloudFormationStackArtifact[],
    all: cxapi.CloudFormationStackArtifact[],
    extend: ExpandStackSelection = ExpandStackSelection.NONE,
  ) {
    const allStacks = new Map<string, cxapi.CloudFormationStackArtifact>();
    for (const stack of all) {
      allStacks.set(stack.hierarchicalId, stack);
    }

    const index = indexByHierarchicalId(matched);

    switch (extend) {
      case ExpandStackSelection.DOWNSTREAM:
        await includeDownstreamStacks(this.ioHelper, index, allStacks);
        break;
      case ExpandStackSelection.UPSTREAM:
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
      if (!selectedStacks.has(id) && (stack.dependencies || []).some(dep => selectedStacks.has(dep.hierarchicalId))) {
        selectedStacks.set(id, stack);
        added.push(id);
        madeProgress = true;
      }
    }
  } while (madeProgress);

  if (added.length > 0) {
    await ioHelper.notify(IO.CDK_TOOLKIT_I1003.msg(`Including depending stacks: ${chalk.bold(added.join(', '))}`));
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
    await ioHelper.notify(IO.CDK_TOOLKIT_I1002.msg(`Including dependency stacks: ${chalk.bold(added.join(', '))}`));
  }
}

/**
 * Build the error message shown when the app has more than one stack but a
 * single-stack selection was requested without a selector.
 *
 * When some of the stacks are nested inside a Stage (i.e. they are not
 * top-level stacks, their hierarchical id is namespaced like `StageName/StackName`),
 * we additionally point the user at a wildcard pattern that selects them, e.g.
 * `'StageName/*'`. Otherwise users are left guessing, since a bare stack name or
 * `--all` is not the most obvious way to target stacks inside a Stage.
 */
export function multipleStacksWithoutSelectorMessage(
  topLevelStacks: cxapi.CloudFormationStackArtifact[],
  allStacks: cxapi.CloudFormationStackArtifact[],
): string {
  const topLevelSet = new Set(topLevelStacks);
  const stagedStacks = allStacks.filter(stack => !topLevelSet.has(stack));

  let message = 'Since this app includes more than a single stack, specify which stacks to use (wildcards are supported) or specify `--all`\n' +
    `Stacks: ${allStacks.map(x => x.hierarchicalId).join(' · ')}`;

  if (stagedStacks.length > 0) {
    const stagePatterns = Array.from(new Set(stagedStacks.map(stack => `${stack.hierarchicalId.split('/')[0]}/*`)));
    message += '\n' +
      'Some of these stacks are nested inside a Stage. To select the stacks in a Stage, ' +
      `use a pattern that matches their full path, e.g. ${stagePatterns.map(p => `'${p}'`).join(', ')}`;
  }

  return message;
}
