import { ExpandStackSelection, StackSelectionStrategy } from '../../../lib';
import {
  ALL_STACKS,
  mustMatch,
  selectAllTopLevel,
  selectExact,
  selectOnlySingle,
  selectWithDownstream,
  selectWithUpstream,
} from '../../../lib/api/cloud-assembly/private';

test('ALL_STACKS selects every stack, including nested assemblies', () => {
  expect(ALL_STACKS).toEqual({
    strategy: StackSelectionStrategy.ALL_STACKS,
  });
});

test('mustMatch upgrades a pattern-match selection', () => {
  expect(mustMatch(selectExact('Stack1'))).toEqual({
    patterns: ['Stack1'],
    strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
    expand: ExpandStackSelection.NONE,
  });
});

test('mustMatch leaves non-pattern strategies unchanged', () => {
  expect(mustMatch(selectAllTopLevel())).toEqual(selectAllTopLevel());
  expect(mustMatch(selectOnlySingle())).toEqual(selectOnlySingle());
  expect(mustMatch(ALL_STACKS)).toEqual(ALL_STACKS);
});

test('selectExact matches the given patterns without expansion', () => {
  expect(selectExact('Stack1', 'Stack2')).toEqual({
    patterns: ['Stack1', 'Stack2'],
    strategy: StackSelectionStrategy.PATTERN_MATCH,
    expand: ExpandStackSelection.NONE,
  });
});

test('selectWithUpstream matches the given patterns and includes upstream dependencies', () => {
  expect(selectWithUpstream('Stack1')).toEqual({
    patterns: ['Stack1'],
    strategy: StackSelectionStrategy.PATTERN_MATCH,
    expand: ExpandStackSelection.UPSTREAM,
  });
});

test('selectWithDownstream matches the given patterns and includes downstream dependents', () => {
  expect(selectWithDownstream('Stack1')).toEqual({
    patterns: ['Stack1'],
    strategy: StackSelectionStrategy.PATTERN_MATCH,
    expand: ExpandStackSelection.DOWNSTREAM,
  });
});

test('selectAllTopLevel selects the main assembly, expanding upstream by default', () => {
  expect(selectAllTopLevel()).toEqual({
    strategy: StackSelectionStrategy.MAIN_ASSEMBLY,
    expand: ExpandStackSelection.UPSTREAM,
  });
});

test('selectAllTopLevel accepts a custom expansion', () => {
  expect(selectAllTopLevel(ExpandStackSelection.DOWNSTREAM)).toEqual({
    strategy: StackSelectionStrategy.MAIN_ASSEMBLY,
    expand: ExpandStackSelection.DOWNSTREAM,
  });
});

test('selectOnlySingle selects the single top-level stack, expanding upstream by default', () => {
  expect(selectOnlySingle()).toEqual({
    patterns: [],
    strategy: StackSelectionStrategy.ONLY_SINGLE,
    expand: ExpandStackSelection.UPSTREAM,
  });
});

test('selectOnlySingle accepts a custom expansion', () => {
  expect(selectOnlySingle(ExpandStackSelection.NONE)).toEqual({
    patterns: [],
    strategy: StackSelectionStrategy.ONLY_SINGLE,
    expand: ExpandStackSelection.NONE,
  });
});
