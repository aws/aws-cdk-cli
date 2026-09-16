import type { StackSelector } from '../stack-selector';
import { ExpandStackSelection, StackSelectionStrategy } from '../stack-selector';

export const ALL_STACKS: StackSelector = {
  strategy: StackSelectionStrategy.ALL_STACKS,
};

/**
 * Require the selector's patterns to match at least one stack
 *
 * Upgrades a `PATTERN_MATCH` selection to `PATTERN_MUST_MATCH`; selectors
 * using any other strategy are returned unchanged (they carry their own
 * error conditions).
 */
export function mustMatch(selector: StackSelector): StackSelector {
  return {
    ...selector,
    strategy: selector.strategy === StackSelectionStrategy.PATTERN_MATCH
      ? StackSelectionStrategy.PATTERN_MUST_MATCH
      : selector.strategy,
  };
}

/**
 * Match the given patterns exactly, without dependency expansion
 */
export function selectExact(...patterns: string[]): StackSelector {
  return {
    patterns,
    strategy: StackSelectionStrategy.PATTERN_MATCH,
    expand: ExpandStackSelection.NONE,
  };
}

/**
 * Match the given patterns and include their upstream dependencies
 */
export function selectWithUpstream(...patterns: string[]): StackSelector {
  return {
    patterns,
    strategy: StackSelectionStrategy.PATTERN_MATCH,
    expand: ExpandStackSelection.UPSTREAM,
  };
}

/**
 * Match the given patterns and include their downstream dependents
 */
export function selectWithDownstream(...patterns: string[]): StackSelector {
  return {
    patterns,
    strategy: StackSelectionStrategy.PATTERN_MATCH,
    expand: ExpandStackSelection.DOWNSTREAM,
  };
}

/**
 * Select all top-level stacks
 */
export function selectAllTopLevel(expand: ExpandStackSelection = ExpandStackSelection.UPSTREAM): StackSelector {
  return {
    strategy: StackSelectionStrategy.MAIN_ASSEMBLY,
    expand,
  };
}

/**
 * Select the single top-level stack of the app
 */
export function selectOnlySingle(expand: ExpandStackSelection = ExpandStackSelection.UPSTREAM): StackSelector {
  return {
    patterns: [],
    strategy: StackSelectionStrategy.ONLY_SINGLE,
    expand,
  };
}
