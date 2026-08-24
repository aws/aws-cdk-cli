import '../../../private/dispose-polyfill';
import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import { isMatch as picomatch } from 'picomatch';
import { major } from 'semver';
import { ToolkitError } from '../../../toolkit/toolkit-error';
import type { IoHelper } from '../../io/private';
import { BaseStackAssembly, ExtendedStackSelection as CliExtendedStackSelection } from '../stack-assembly';
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
export class StackAssembly extends BaseStackAssembly implements IReadableCloudAssembly {
  private _allStacks: CloudFormationStackArtifact[] | undefined;

  constructor(private readonly _asm: IReadableCloudAssembly, ioHelper: IoHelper) {
    super(_asm.cloudAssembly, ioHelper);
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
  private get allStacks(): CloudFormationStackArtifact[] {
    if (!this._allStacks) {
      this._allStacks = major(this.assembly.version) < 10 ? this.assembly.stacks : this.assembly.stacksRecursively;
    }

    return this._allStacks;
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

    if (allStacks.length === 0 && (selector.failOnEmpty ?? true)) {
      throw new ToolkitError('NoStacksInApp', 'This app contains no stacks');
    }

    const extend = expandToExtendEnum(selector.expand);
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
          throw new ToolkitError('MultipleStacksWithoutSelector', 'Since this app includes more than a single stack, specify which stacks to use (wildcards are supported) or specify `--all`\n' +
          `Stacks: ${allStacks.map(x => x.hierarchicalId).join(' · ')}`);
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
            `Stack selection is ambiguous, please choose a specific stack for import [${allStacks.map(x => x.hierarchicalId).join(',')}]`,
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
}

function expandToExtendEnum(extend?: ExpandStackSelection): CliExtendedStackSelection | undefined {
  switch (extend) {
    case ExpandStackSelection.DOWNSTREAM:
      return CliExtendedStackSelection.Downstream;
    case ExpandStackSelection.UPSTREAM:
      return CliExtendedStackSelection.Upstream;
    case ExpandStackSelection.NONE:
      return CliExtendedStackSelection.None;
    default:
      return undefined;
  }
}
