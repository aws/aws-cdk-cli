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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stc2VsZWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2Nsb3VkLWFzc2VtYmx5L3N0YWNrLXNlbGVjdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOztHQUVHO0FBQ0gsSUFBWSxzQkFvQ1g7QUFwQ0QsV0FBWSxzQkFBc0I7SUFDaEM7OztPQUdHO0lBQ0gsbURBQXlCLENBQUE7SUFFekI7O09BRUc7SUFDSCx5REFBK0IsQ0FBQTtJQUUvQjs7O09BR0c7SUFDSCxxREFBMkIsQ0FBQTtJQUUzQjs7OztPQUlHO0lBQ0gseURBQStCLENBQUE7SUFFL0I7OztPQUdHO0lBQ0gsbUVBQXlDLENBQUE7SUFFekM7OztPQUdHO0lBQ0gsaUZBQXVELENBQUE7QUFDekQsQ0FBQyxFQXBDVyxzQkFBc0Isc0NBQXRCLHNCQUFzQixRQW9DakM7QUFFRDs7R0FFRztBQUNILElBQVksb0JBc0JYO0FBdEJELFdBQVksb0JBQW9CO0lBQzlCOztPQUVHO0lBQ0gscUNBQWEsQ0FBQTtJQUViOztPQUVHO0lBQ0gsNkNBQXFCLENBQUE7SUFFckI7O09BRUc7SUFDSCxpREFBeUIsQ0FBQTtJQUV6Qjs7OztPQUlHO0lBQ0gsaUJBQWlCO0FBQ25CLENBQUMsRUF0Qlcsb0JBQW9CLG9DQUFwQixvQkFBb0IsUUFzQi9CIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBXaGljaCBzdGFja3Mgc2hvdWxkIGJlIHNlbGVjdGVkIGZyb20gYSBjbG91ZCBhc3NlbWJseVxuICovXG5leHBvcnQgZW51bSBTdGFja1NlbGVjdGlvblN0cmF0ZWd5IHtcbiAgLyoqXG4gICAqIFJldHVybnMgYWxsIHN0YWNrcyBpbiB0aGUgYXBwIHJlZ2FyZGxlc3Mgb2YgcGF0dGVybnMsXG4gICAqIGluY2x1ZGluZyBzdGFja3MgaW5zaWRlIG5lc3RlZCBhc3NlbWJsaWVzLlxuICAgKi9cbiAgQUxMX1NUQUNLUyA9ICdhbGwtc3RhY2tzJyxcblxuICAvKipcbiAgICogUmV0dXJucyBhbGwgc3RhY2tzIGluIHRoZSBtYWluICh0b3AgbGV2ZWwpIGFzc2VtYmx5IG9ubHkuXG4gICAqL1xuICBNQUlOX0FTU0VNQkxZID0gJ21haW4tYXNzZW1ibHknLFxuXG4gIC8qKlxuICAgKiBJZiB0aGUgYXNzZW1ibHkgaW5jbHVkZXMgYSBzaW5nbGUgc3RhY2ssIHJldHVybnMgaXQuXG4gICAqIE90aGVyd2lzZSB0aHJvd3MgYW4gZXhjZXB0aW9uLlxuICAgKi9cbiAgT05MWV9TSU5HTEUgPSAnb25seS1zaW5nbGUnLFxuXG4gIC8qKlxuICAgKiBSZXR1cm4gc3RhY2tzIG1hdGNoZWQgYnkgcGF0dGVybnMuXG4gICAqIElmIG5vIHN0YWNrcyBhcmUgZm91bmQsIGV4ZWN1dGlvbiBpcyBoYWx0ZWQgc3VjY2Vzc2Z1bGx5LlxuICAgKiBNb3N0IGxpa2VseSB5b3UgZG9uJ3Qgd2FudCB0byB1c2UgdGhpcyBidXQgYFN0YWNrU2VsZWN0aW9uU3RyYXRlZ3kuTVVTVF9NQVRDSF9QQVRURVJOYFxuICAgKi9cbiAgUEFUVEVSTl9NQVRDSCA9ICdwYXR0ZXJuLW1hdGNoJyxcblxuICAvKipcbiAgICogUmV0dXJuIHN0YWNrcyBtYXRjaGVkIGJ5IHBhdHRlcm5zLlxuICAgKiBUaHJvd3MgYW4gZXhjZXB0aW9uIGlmIHRoZSBwYXR0ZXJucyBkb24ndCBtYXRjaCBhdCBsZWFzdCBvbmUgc3RhY2sgaW4gdGhlIGFzc2VtYmx5LlxuICAgKi9cbiAgUEFUVEVSTl9NVVNUX01BVENIID0gJ3BhdHRlcm4tbXVzdC1tYXRjaCcsXG5cbiAgLyoqXG4gICAqIFJldHVybnMgaWYgZXhhY3RseSBvbmUgc3RhY2sgaXMgbWF0Y2hlZCBieSB0aGUgcGF0dGVybihzKS5cbiAgICogVGhyb3dzIGFuIGV4Y2VwdGlvbiBpZiBubyBzdGFjaywgb3IgbW9yZSB0aGFuIGV4YWN0bHkgb25lIHN0YWNrIGFyZSBtYXRjaGVkLlxuICAgKi9cbiAgUEFUVEVSTl9NVVNUX01BVENIX1NJTkdMRSA9ICdwYXR0ZXJuLW11c3QtbWF0Y2gtc2luZ2xlJyxcbn1cblxuLyoqXG4gKiBXaGVuIHNlbGVjdGluZyBzdGFja3MsIHdoYXQgb3RoZXIgc3RhY2tzIHRvIGluY2x1ZGUgYmVjYXVzZSBvZiBkZXBlbmRlbmNpZXNcbiAqL1xuZXhwb3J0IGVudW0gRXhwYW5kU3RhY2tTZWxlY3Rpb24ge1xuICAvKipcbiAgICogRG9uJ3Qgc2VsZWN0IGFueSBleHRyYSBzdGFja3NcbiAgICovXG4gIE5PTkUgPSAnbm9uZScsXG5cbiAgLyoqXG4gICAqIEluY2x1ZGUgc3RhY2tzIHRoYXQgdGhpcyBzdGFjayBkZXBlbmRzIG9uXG4gICAqL1xuICBVUFNUUkVBTSA9ICd1cHN0cmVhbScsXG5cbiAgLyoqXG4gICAqIEluY2x1ZGUgc3RhY2tzIHRoYXQgZGVwZW5kIG9uIHRoaXMgc3RhY2tcbiAgICovXG4gIERPV05TVFJFQU0gPSAnZG93bnN0cmVhbScsXG5cbiAgLyoqXG4gICAqIEBUT0RPXG4gICAqIEluY2x1ZGUgYm90aCBkaXJlY3Rpb25zLlxuICAgKiBJLmUuIHN0YWNrcyB0aGF0IHRoaXMgc3RhY2sgZGVwZW5kcyBvbiwgYW5kIHN0YWNrcyB0aGF0IGRlcGVuZCBvbiB0aGlzIHN0YWNrLlxuICAgKi9cbiAgLy8gRlVMTCA9ICdmdWxsJyxcbn1cblxuLyoqXG4gKiBBIHNwZWNpZmljYXRpb24gb2Ygd2hpY2ggc3RhY2tzIHNob3VsZCBiZSBzZWxlY3RlZFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YWNrU2VsZWN0b3Ige1xuICAvKipcbiAgICogVGhlIGJlaGF2aW9yIGlmIGlmIG5vIHNlbGVjdG9ycyBhcmUgcHJvdmlkZWQuXG4gICAqL1xuICBzdHJhdGVneTogU3RhY2tTZWxlY3Rpb25TdHJhdGVneTtcblxuICAvKipcbiAgICogQSBsaXN0IG9mIHBhdHRlcm5zIHRvIG1hdGNoIHRoZSBzdGFjayBoaWVyYXJjaGljYWwgaWRzXG4gICAqIE9ubHkgdXNlZCB3aXRoIGBQQVRURVJOXypgIHNlbGVjdGlvbiBzdHJhdGVnaWVzLlxuICAgKi9cbiAgcGF0dGVybnM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogRXhwYW5kIHRoZSBzZWxlY3Rpb24gdG8gdXBzdHJlYW0vZG93bnN0cmVhbSBzdGFja3MuXG4gICAqIEBkZWZhdWx0IEV4cGFuZFN0YWNrU2VsZWN0aW9uLk5vbmUgb25seSBzZWxlY3QgdGhlIHNwZWNpZmllZC9tYXRjaGVkIHN0YWNrc1xuICAgKi9cbiAgZXhwYW5kPzogRXhwYW5kU3RhY2tTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIEJ5IGRlZmF1bHQsIHdlIHRocm93IGFuIGV4Y2VwdGlvbiBpZiB0aGUgYXNzZW1ibHkgY29udGFpbnMgbm8gc3RhY2tzLlxuICAgKiBTZXQgdG8gYGZhbHNlYCwgdG8gaGFsdCBleGVjdXRpb24gZm9yIGVtcHR5IGFzc2VtYmxpZXMgd2l0aG91dCBlcnJvci5cbiAgICpcbiAgICogTm90ZSB0aGF0IGFjdGlvbnMgY2FuIHN0aWxsIHRocm93IGlmIGEgc3RhY2sgc2VsZWN0aW9uIHJlc3VsdCBpcyBlbXB0eSxcbiAgICogYnV0IHRoZSBhc3NlbWJseSBjb250YWlucyBzdGFja3MgaW4gcHJpbmNpcGxlLlxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICBmYWlsT25FbXB0eT86IGJvb2xlYW47XG59XG4iXX0=