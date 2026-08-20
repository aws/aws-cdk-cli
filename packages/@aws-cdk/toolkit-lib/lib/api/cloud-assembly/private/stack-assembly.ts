import '../../../private/dispose-polyfill';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { major } from 'semver';
import { ToolkitError } from '../../../toolkit/toolkit-error';
import type { IoHelper } from '../../io/private';
import { BaseStackAssembly, ExtendedStackSelection as CliExtendedStackSelection } from '../stack-assembly';
import { StackCollection } from '../stack-collection';
import type { StackSelector } from '../stack-selector';
import { ExpandStackSelection, StackSelectionStrategy } from '../stack-selector';
import type { IReadableCloudAssembly } from '../types';

/**
 * A single Cloud Assembly wrapped to provide additional stack operations.
 */
export class StackAssembly extends BaseStackAssembly implements IReadableCloudAssembly {
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
   * Improved stack selection interface with a single selector
   * @throws when the assembly does not contain any stacks, unless `selector.failOnEmpty` is `false`
   * @throws when individual selection strategies are not satisfied
   */
  public async selectStacksV2(selector: StackSelector): Promise<StackCollection> {
    const asm = this.assembly;
    const topLevelStacks = asm.stacks;
    const allStacks = major(asm.version) < 10 ? asm.stacks : asm.stacksRecursively;

    if (allStacks.length === 0 && (selector.failOnEmpty ?? true)) {
      throw new ToolkitError('NoStacksInApp', 'This app contains no stacks');
    }

    const extend = expandToExtendEnum(selector.expand);
    const patterns = StackAssembly.sanitizePatterns(selector.patterns ?? []);

    switch (selector.strategy) {
      case StackSelectionStrategy.ALL_STACKS:
        return new StackCollection(this, allStacks);
      case StackSelectionStrategy.MAIN_ASSEMBLY:
        if (topLevelStacks.length < 1) {
          // @todo text should probably be handled in io host
          throw new ToolkitError('NoStackInMainAssembly', 'No stack found in the main cloud assembly. Use "list" to print manifest');
        }
        return this.extendStacks(topLevelStacks, allStacks, extend);
      case StackSelectionStrategy.ONLY_SINGLE:
        if (topLevelStacks.length !== 1) {
          // @todo text should probably be handled in io host
          throw new ToolkitError('MultipleStacksWithoutSelector', multipleStacksWithoutSelectorMessage(topLevelStacks, allStacks));
        }
        return new StackCollection(this, topLevelStacks);
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

        return matched;
    }
  }

  /**
   * Select all stacks.
   *
   * This method never throws and can safely be used as a basis for other calculations.
   *
   * @returns a `StackCollection` of all stacks
   */
  public selectAllStacks() {
    const allStacks = major(this.assembly.version) < 10 ? this.assembly.stacks : this.assembly.stacksRecursively;
    return new StackCollection(this, allStacks);
  }

  /**
   * Select all stacks that have the validateOnSynth flag et.
   *
   * @returns a `StackCollection` of all stacks that needs to be validated
   */
  public selectStacksForValidation() {
    const allStacks = this.selectAllStacks();
    return allStacks.filter((art) => art.validateOnSynth ?? false);
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
