import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { isMatch as picomatch } from 'picomatch';
import * as semver from 'semver';
import { BaseStackAssembly, StackCollection } from '../api/cloud-assembly';
import { flatten } from '../util';

export enum DefaultSelection {
  /**
   * Returns an empty selection in case there are no selectors.
   */
  None = 'none',

  /**
   * If the app includes a single stack, returns it. Otherwise throws an exception.
   * This behavior is used by "deploy".
   */
  OnlySingle = 'single',

  /**
   * Returns all stacks in the main (top level) assembly only.
   */
  MainAssembly = 'main',

  /**
   * If no selectors are provided, returns all stacks in the app,
   * including stacks inside nested assemblies.
   */
  AllStacks = 'all',
}

export interface SelectStacksOptions {
  /**
   * Extend the selection to upstread/downstream stacks
   * @default ExtendedStackSelection.None only select the specified stacks.
   */
  extend?: ExtendedStackSelection;

  /**
   * The behavior if no selectors are provided.
   */
  defaultBehavior: DefaultSelection;

  /**
   * Whether to deploy if the app contains no stacks.
   *
   * @default false
   */
  ignoreNoStacks?: boolean;
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
 * A specification of which stacks should be selected
 */
export interface StackSelector {
  /**
   * Whether all stacks at the top level assembly should
   * be selected and nothing else
   */
  allTopLevel?: boolean;

  /**
   * A list of patterns to match the stack hierarchical ids
   */
  patterns: string[];
}

/**
 * A single Cloud Assembly and the operations we do on it to deploy the artifacts inside
 */
export class CloudAssembly extends BaseStackAssembly {
  public async selectStacks(selector: StackSelector, options: SelectStacksOptions): Promise<StackCollection> {
    const asm = this.assembly;
    const topLevelStacks = asm.stacks;
    const stacks = semver.major(asm.version) < 10 ? asm.stacks : asm.stacksRecursively;
    const allTopLevel = selector.allTopLevel ?? false;
    const patterns = CloudAssembly.sanitizePatterns(selector.patterns);

    if (stacks.length === 0) {
      if (options.ignoreNoStacks) {
        return new StackCollection(this, []);
      }
      throw new ToolkitError('NoStacks', 'This app contains no stacks');
    }

    if (allTopLevel) {
      return this.selectTopLevelStacks(stacks, topLevelStacks, options.extend);
    } else if (patterns.length > 0) {
      return this.selectMatchingStacks(stacks, patterns, options.extend);
    } else {
      return this.selectDefaultStacks(stacks, topLevelStacks, options.defaultBehavior);
    }
  }

  private async selectTopLevelStacks(
    stacks: cxapi.CloudFormationStackArtifact[],
    topLevelStacks: cxapi.CloudFormationStackArtifact[],
    extend: ExtendedStackSelection = ExtendedStackSelection.None,
  ): Promise<StackCollection> {
    if (topLevelStacks.length > 0) {
      return this.extendStacks(topLevelStacks, stacks, extend);
    } else {
      throw new ToolkitError('NoStackInMainAssembly', 'No stack found in the main cloud assembly. Use "list" to print manifest');
    }
  }

  protected async selectMatchingStacks(
    stacks: cxapi.CloudFormationStackArtifact[],
    patterns: string[],
    extend: ExtendedStackSelection = ExtendedStackSelection.None,
  ): Promise<StackCollection> {
    const matchingPattern = (pattern: string) => (stack: cxapi.CloudFormationStackArtifact) => picomatch(stack.hierarchicalId, pattern);
    const matchedStacks = flatten(patterns.map(pattern => stacks.filter(matchingPattern(pattern))));
    return this.extendStacks(matchedStacks, stacks, extend);
  }

  private selectDefaultStacks(
    stacks: cxapi.CloudFormationStackArtifact[],
    topLevelStacks: cxapi.CloudFormationStackArtifact[],
    defaultSelection: DefaultSelection,
  ) {
    switch (defaultSelection) {
      case DefaultSelection.MainAssembly:
        return new StackCollection(this, topLevelStacks);
      case DefaultSelection.AllStacks:
        return new StackCollection(this, stacks);
      case DefaultSelection.None:
        return new StackCollection(this, []);
      case DefaultSelection.OnlySingle:
        if (topLevelStacks.length === 1) {
          return new StackCollection(this, topLevelStacks);
        } else {
          throw new ToolkitError('NoSelectorGiven', noSelectorGivenMessage(topLevelStacks, stacks));
        }
      default:
        throw new ToolkitError('InvalidDefaultBehavior', `invalid default behavior: ${defaultSelection}`);
    }
  }
}

/**
 * Build the error message shown when the app has more than one stack but no
 * selector was given.
 *
 * When some of the stacks are nested inside a Stage (i.e. they are not
 * top-level stacks, their hierarchical id is namespaced like `StageName/StackName`),
 * we additionally point the user at a wildcard pattern that selects them, e.g.
 * `'StageName/*'`. Otherwise users are left guessing, since a bare stack name or
 * `--all` is not the most obvious way to target stacks inside a Stage.
 */
export function noSelectorGivenMessage(
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
