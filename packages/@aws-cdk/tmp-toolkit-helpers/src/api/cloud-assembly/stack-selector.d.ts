/**
 * Which stacks should be selected from a cloud assembly
 */
export declare enum StackSelectionStrategy {
    /**
     * Returns all stacks in the app regardless of patterns,
     * including stacks inside nested assemblies.
     */
    ALL_STACKS = "all-stacks",
    /**
     * Returns all stacks in the main (top level) assembly only.
     */
    MAIN_ASSEMBLY = "main-assembly",
    /**
     * If the assembly includes a single stack, returns it.
     * Otherwise throws an exception.
     */
    ONLY_SINGLE = "only-single",
    /**
     * Return stacks matched by patterns.
     * If no stacks are found, execution is halted successfully.
     * Most likely you don't want to use this but `StackSelectionStrategy.MUST_MATCH_PATTERN`
     */
    PATTERN_MATCH = "pattern-match",
    /**
     * Return stacks matched by patterns.
     * Throws an exception if the patterns don't match at least one stack in the assembly.
     */
    PATTERN_MUST_MATCH = "pattern-must-match",
    /**
     * Returns if exactly one stack is matched by the pattern(s).
     * Throws an exception if no stack, or more than exactly one stack are matched.
     */
    PATTERN_MUST_MATCH_SINGLE = "pattern-must-match-single"
}
/**
 * When selecting stacks, what other stacks to include because of dependencies
 */
export declare enum ExpandStackSelection {
    /**
     * Don't select any extra stacks
     */
    NONE = "none",
    /**
     * Include stacks that this stack depends on
     */
    UPSTREAM = "upstream",
    /**
     * Include stacks that depend on this stack
     */
    DOWNSTREAM = "downstream"
}
/**
 * A specification of which stacks should be selected
 */
export interface StackSelector {
    /**
     * The behavior if if no selectors are provided.
     */
    strategy: StackSelectionStrategy;
    /**
     * A list of patterns to match the stack hierarchical ids
     * Only used with `PATTERN_*` selection strategies.
     */
    patterns?: string[];
    /**
     * Expand the selection to upstream/downstream stacks.
     * @default ExpandStackSelection.None only select the specified/matched stacks
     */
    expand?: ExpandStackSelection;
    /**
     * By default, we throw an exception if the assembly contains no stacks.
     * Set to `false`, to halt execution for empty assemblies without error.
     *
     * Note that actions can still throw if a stack selection result is empty,
     * but the assembly contains stacks in principle.
     *
     * @default true
     */
    failOnEmpty?: boolean;
}
