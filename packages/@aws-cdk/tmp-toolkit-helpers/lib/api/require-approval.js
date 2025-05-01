"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequireApproval = void 0;
/**
 * @deprecated
 */
var RequireApproval;
(function (RequireApproval) {
    /**
     * Never require any security approvals
     */
    RequireApproval["NEVER"] = "never";
    /**
     * Any security changes require an approval
     */
    RequireApproval["ANY_CHANGE"] = "any-change";
    /**
     * Require approval only for changes that are access broadening
     */
    RequireApproval["BROADENING"] = "broadening";
})(RequireApproval || (exports.RequireApproval = RequireApproval = {}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVxdWlyZS1hcHByb3ZhbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9hcGkvcmVxdWlyZS1hcHByb3ZhbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7R0FFRztBQUNILElBQVksZUFhWDtBQWJELFdBQVksZUFBZTtJQUN6Qjs7T0FFRztJQUNILGtDQUFlLENBQUE7SUFDZjs7T0FFRztJQUNILDRDQUF5QixDQUFBO0lBQ3pCOztPQUVHO0lBQ0gsNENBQXlCLENBQUE7QUFDM0IsQ0FBQyxFQWJXLGVBQWUsK0JBQWYsZUFBZSxRQWExQiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGRlcHJlY2F0ZWRcbiAqL1xuZXhwb3J0IGVudW0gUmVxdWlyZUFwcHJvdmFsIHtcbiAgLyoqXG4gICAqIE5ldmVyIHJlcXVpcmUgYW55IHNlY3VyaXR5IGFwcHJvdmFsc1xuICAgKi9cbiAgTkVWRVIgPSAnbmV2ZXInLFxuICAvKipcbiAgICogQW55IHNlY3VyaXR5IGNoYW5nZXMgcmVxdWlyZSBhbiBhcHByb3ZhbFxuICAgKi9cbiAgQU5ZX0NIQU5HRSA9ICdhbnktY2hhbmdlJyxcbiAgLyoqXG4gICAqIFJlcXVpcmUgYXBwcm92YWwgb25seSBmb3IgY2hhbmdlcyB0aGF0IGFyZSBhY2Nlc3MgYnJvYWRlbmluZ1xuICAgKi9cbiAgQlJPQURFTklORyA9ICdicm9hZGVuaW5nJyxcbn1cbiJdfQ==