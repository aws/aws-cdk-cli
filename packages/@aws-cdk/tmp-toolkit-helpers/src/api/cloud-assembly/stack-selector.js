"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpandStackSelection = exports.StackSelectionStrategy = void 0;
/**
 * Which stacks should be selected from a cloud assembly
 */
var StackSelectionStrategy;
(function (StackSelectionStrategy) {
    /**
     * Returns all stacks in the app regardless of patterns,
     * including stacks inside nested assemblies.
     */
    StackSelectionStrategy["ALL_STACKS"] = "all-stacks";
    /**
     * Returns all stacks in the main (top level) assembly only.
     */
    StackSelectionStrategy["MAIN_ASSEMBLY"] = "main-assembly";
    /**
     * If the assembly includes a single stack, returns it.
     * Otherwise throws an exception.
     */
    StackSelectionStrategy["ONLY_SINGLE"] = "only-single";
    /**
     * Return stacks matched by patterns.
     * If no stacks are found, execution is halted successfully.
     * Most likely you don't want to use this but `StackSelectionStrategy.MUST_MATCH_PATTERN`
     */
    StackSelectionStrategy["PATTERN_MATCH"] = "pattern-match";
    /**
     * Return stacks matched by patterns.
     * Throws an exception if the patterns don't match at least one stack in the assembly.
     */
    StackSelectionStrategy["PATTERN_MUST_MATCH"] = "pattern-must-match";
    /**
     * Returns if exactly one stack is matched by the pattern(s).
     * Throws an exception if no stack, or more than exactly one stack are matched.
     */
    StackSelectionStrategy["PATTERN_MUST_MATCH_SINGLE"] = "pattern-must-match-single";
})(StackSelectionStrategy || (exports.StackSelectionStrategy = StackSelectionStrategy = {}));
/**
 * When selecting stacks, what other stacks to include because of dependencies
 */
var ExpandStackSelection;
(function (ExpandStackSelection) {
    /**
     * Don't select any extra stacks
     */
    ExpandStackSelection["NONE"] = "none";
    /**
     * Include stacks that this stack depends on
     */
    ExpandStackSelection["UPSTREAM"] = "upstream";
    /**
     * Include stacks that depend on this stack
     */
    ExpandStackSelection["DOWNSTREAM"] = "downstream";
    /**
     * @TODO
     * Include both directions.
     * I.e. stacks that this stack depends on, and stacks that depend on this stack.
     */
    // FULL = 'full',
})(ExpandStackSelection || (exports.ExpandStackSelection = ExpandStackSelection = {}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stc2VsZWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzdGFjay1zZWxlY3Rvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7R0FFRztBQUNILElBQVksc0JBb0NYO0FBcENELFdBQVksc0JBQXNCO0lBQ2hDOzs7T0FHRztJQUNILG1EQUF5QixDQUFBO0lBRXpCOztPQUVHO0lBQ0gseURBQStCLENBQUE7SUFFL0I7OztPQUdHO0lBQ0gscURBQTJCLENBQUE7SUFFM0I7Ozs7T0FJRztJQUNILHlEQUErQixDQUFBO0lBRS9COzs7T0FHRztJQUNILG1FQUF5QyxDQUFBO0lBRXpDOzs7T0FHRztJQUNILGlGQUF1RCxDQUFBO0FBQ3pELENBQUMsRUFwQ1csc0JBQXNCLHNDQUF0QixzQkFBc0IsUUFvQ2pDO0FBRUQ7O0dBRUc7QUFDSCxJQUFZLG9CQXNCWDtBQXRCRCxXQUFZLG9CQUFvQjtJQUM5Qjs7T0FFRztJQUNILHFDQUFhLENBQUE7SUFFYjs7T0FFRztJQUNILDZDQUFxQixDQUFBO0lBRXJCOztPQUVHO0lBQ0gsaURBQXlCLENBQUE7SUFFekI7Ozs7T0FJRztJQUNILGlCQUFpQjtBQUNuQixDQUFDLEVBdEJXLG9CQUFvQixvQ0FBcEIsb0JBQW9CLFFBc0IvQiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogV2hpY2ggc3RhY2tzIHNob3VsZCBiZSBzZWxlY3RlZCBmcm9tIGEgY2xvdWQgYXNzZW1ibHlcbiAqL1xuZXhwb3J0IGVudW0gU3RhY2tTZWxlY3Rpb25TdHJhdGVneSB7XG4gIC8qKlxuICAgKiBSZXR1cm5zIGFsbCBzdGFja3MgaW4gdGhlIGFwcCByZWdhcmRsZXNzIG9mIHBhdHRlcm5zLFxuICAgKiBpbmNsdWRpbmcgc3RhY2tzIGluc2lkZSBuZXN0ZWQgYXNzZW1ibGllcy5cbiAgICovXG4gIEFMTF9TVEFDS1MgPSAnYWxsLXN0YWNrcycsXG5cbiAgLyoqXG4gICAqIFJldHVybnMgYWxsIHN0YWNrcyBpbiB0aGUgbWFpbiAodG9wIGxldmVsKSBhc3NlbWJseSBvbmx5LlxuICAgKi9cbiAgTUFJTl9BU1NFTUJMWSA9ICdtYWluLWFzc2VtYmx5JyxcblxuICAvKipcbiAgICogSWYgdGhlIGFzc2VtYmx5IGluY2x1ZGVzIGEgc2luZ2xlIHN0YWNrLCByZXR1cm5zIGl0LlxuICAgKiBPdGhlcndpc2UgdGhyb3dzIGFuIGV4Y2VwdGlvbi5cbiAgICovXG4gIE9OTFlfU0lOR0xFID0gJ29ubHktc2luZ2xlJyxcblxuICAvKipcbiAgICogUmV0dXJuIHN0YWNrcyBtYXRjaGVkIGJ5IHBhdHRlcm5zLlxuICAgKiBJZiBubyBzdGFja3MgYXJlIGZvdW5kLCBleGVjdXRpb24gaXMgaGFsdGVkIHN1Y2Nlc3NmdWxseS5cbiAgICogTW9zdCBsaWtlbHkgeW91IGRvbid0IHdhbnQgdG8gdXNlIHRoaXMgYnV0IGBTdGFja1NlbGVjdGlvblN0cmF0ZWd5Lk1VU1RfTUFUQ0hfUEFUVEVSTmBcbiAgICovXG4gIFBBVFRFUk5fTUFUQ0ggPSAncGF0dGVybi1tYXRjaCcsXG5cbiAgLyoqXG4gICAqIFJldHVybiBzdGFja3MgbWF0Y2hlZCBieSBwYXR0ZXJucy5cbiAgICogVGhyb3dzIGFuIGV4Y2VwdGlvbiBpZiB0aGUgcGF0dGVybnMgZG9uJ3QgbWF0Y2ggYXQgbGVhc3Qgb25lIHN0YWNrIGluIHRoZSBhc3NlbWJseS5cbiAgICovXG4gIFBBVFRFUk5fTVVTVF9NQVRDSCA9ICdwYXR0ZXJuLW11c3QtbWF0Y2gnLFxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGlmIGV4YWN0bHkgb25lIHN0YWNrIGlzIG1hdGNoZWQgYnkgdGhlIHBhdHRlcm4ocykuXG4gICAqIFRocm93cyBhbiBleGNlcHRpb24gaWYgbm8gc3RhY2ssIG9yIG1vcmUgdGhhbiBleGFjdGx5IG9uZSBzdGFjayBhcmUgbWF0Y2hlZC5cbiAgICovXG4gIFBBVFRFUk5fTVVTVF9NQVRDSF9TSU5HTEUgPSAncGF0dGVybi1tdXN0LW1hdGNoLXNpbmdsZScsXG59XG5cbi8qKlxuICogV2hlbiBzZWxlY3Rpbmcgc3RhY2tzLCB3aGF0IG90aGVyIHN0YWNrcyB0byBpbmNsdWRlIGJlY2F1c2Ugb2YgZGVwZW5kZW5jaWVzXG4gKi9cbmV4cG9ydCBlbnVtIEV4cGFuZFN0YWNrU2VsZWN0aW9uIHtcbiAgLyoqXG4gICAqIERvbid0IHNlbGVjdCBhbnkgZXh0cmEgc3RhY2tzXG4gICAqL1xuICBOT05FID0gJ25vbmUnLFxuXG4gIC8qKlxuICAgKiBJbmNsdWRlIHN0YWNrcyB0aGF0IHRoaXMgc3RhY2sgZGVwZW5kcyBvblxuICAgKi9cbiAgVVBTVFJFQU0gPSAndXBzdHJlYW0nLFxuXG4gIC8qKlxuICAgKiBJbmNsdWRlIHN0YWNrcyB0aGF0IGRlcGVuZCBvbiB0aGlzIHN0YWNrXG4gICAqL1xuICBET1dOU1RSRUFNID0gJ2Rvd25zdHJlYW0nLFxuXG4gIC8qKlxuICAgKiBAVE9ET1xuICAgKiBJbmNsdWRlIGJvdGggZGlyZWN0aW9ucy5cbiAgICogSS5lLiBzdGFja3MgdGhhdCB0aGlzIHN0YWNrIGRlcGVuZHMgb24sIGFuZCBzdGFja3MgdGhhdCBkZXBlbmQgb24gdGhpcyBzdGFjay5cbiAgICovXG4gIC8vIEZVTEwgPSAnZnVsbCcsXG59XG5cbi8qKlxuICogQSBzcGVjaWZpY2F0aW9uIG9mIHdoaWNoIHN0YWNrcyBzaG91bGQgYmUgc2VsZWN0ZWRcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGFja1NlbGVjdG9yIHtcbiAgLyoqXG4gICAqIFRoZSBiZWhhdmlvciBpZiBpZiBubyBzZWxlY3RvcnMgYXJlIHByb3ZpZGVkLlxuICAgKi9cbiAgc3RyYXRlZ3k6IFN0YWNrU2VsZWN0aW9uU3RyYXRlZ3k7XG5cbiAgLyoqXG4gICAqIEEgbGlzdCBvZiBwYXR0ZXJucyB0byBtYXRjaCB0aGUgc3RhY2sgaGllcmFyY2hpY2FsIGlkc1xuICAgKiBPbmx5IHVzZWQgd2l0aCBgUEFUVEVSTl8qYCBzZWxlY3Rpb24gc3RyYXRlZ2llcy5cbiAgICovXG4gIHBhdHRlcm5zPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEV4cGFuZCB0aGUgc2VsZWN0aW9uIHRvIHVwc3RyZWFtL2Rvd25zdHJlYW0gc3RhY2tzLlxuICAgKiBAZGVmYXVsdCBFeHBhbmRTdGFja1NlbGVjdGlvbi5Ob25lIG9ubHkgc2VsZWN0IHRoZSBzcGVjaWZpZWQvbWF0Y2hlZCBzdGFja3NcbiAgICovXG4gIGV4cGFuZD86IEV4cGFuZFN0YWNrU2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBCeSBkZWZhdWx0LCB3ZSB0aHJvdyBhbiBleGNlcHRpb24gaWYgdGhlIGFzc2VtYmx5IGNvbnRhaW5zIG5vIHN0YWNrcy5cbiAgICogU2V0IHRvIGBmYWxzZWAsIHRvIGhhbHQgZXhlY3V0aW9uIGZvciBlbXB0eSBhc3NlbWJsaWVzIHdpdGhvdXQgZXJyb3IuXG4gICAqXG4gICAqIE5vdGUgdGhhdCBhY3Rpb25zIGNhbiBzdGlsbCB0aHJvdyBpZiBhIHN0YWNrIHNlbGVjdGlvbiByZXN1bHQgaXMgZW1wdHksXG4gICAqIGJ1dCB0aGUgYXNzZW1ibHkgY29udGFpbnMgc3RhY2tzIGluIHByaW5jaXBsZS5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgZmFpbE9uRW1wdHk/OiBib29sZWFuO1xufVxuIl19