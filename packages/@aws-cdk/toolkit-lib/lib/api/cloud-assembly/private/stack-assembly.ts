import type * as cxapi from '@aws-cdk/cx-api';
import { major } from 'semver';
import type { ILock, IoHelper } from '../../shared-private';
import { BaseStackAssembly, StackCollection, ExtendedStackSelection as CliExtendedStackSelection } from '../../shared-private';
import { ToolkitError } from '../../shared-public';
import type { StackSelector } from '../stack-selector';
import { ExpandStackSelection, StackSelectionStrategy } from '../stack-selector';
import type { ICloudAssemblySource } from '../types';

/**
 * A single Cloud Assembly wrapped to provide additional stack operations.
 */
export class StackAssembly extends BaseStackAssembly implements ICloudAssemblySource, AsyncDisposable {
  private readonly lock: ILock;

  public constructor(public readonly assembly: cxapi.CloudAssembly, ioHelper: IoHelper, lock: ILock) {
    super(assembly, ioHelper);
    this.lock = lock;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.lock.release();
  }

  public async produce(): Promise<cxapi.CloudAssembly> {
    return this.assembly;
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
      throw new ToolkitError('This app contains no stacks');
    }

    const extend = expandToExtendEnum(selector.expand);
    const patterns = StackAssembly.sanitizePatterns(selector.patterns ?? []);

    switch (selector.strategy) {
      case StackSelectionStrategy.ALL_STACKS:
        return new StackCollection(this, allStacks);
      case StackSelectionStrategy.MAIN_ASSEMBLY:
        if (topLevelStacks.length < 1) {
          // @todo text should probably be handled in io host
          throw new ToolkitError('No stack found in the main cloud assembly. Use "list" to print manifest');
        }
        return this.extendStacks(topLevelStacks, allStacks, extend);
      case StackSelectionStrategy.ONLY_SINGLE:
        if (topLevelStacks.length !== 1) {
          // @todo text should probably be handled in io host
          throw new ToolkitError('Since this app includes more than a single stack, specify which stacks to use (wildcards are supported) or specify `--all`\n' +
          `Stacks: ${allStacks.map(x => x.hierarchicalId).join(' · ')}`);
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
            `Stack selection is ambiguous, please choose a specific stack for import [${allStacks.map(x => x.hierarchicalId).join(',')}]`,
          );
        }
        if (
          selector.strategy === StackSelectionStrategy.PATTERN_MUST_MATCH
          && matched.stackCount < 1
        ) {
          // @todo text should probably be handled in io host
          throw new ToolkitError(
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
