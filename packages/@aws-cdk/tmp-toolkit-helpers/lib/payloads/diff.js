"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionChangeType = void 0;
/**
 * Different types of permission related changes in a diff
 */
var PermissionChangeType;
(function (PermissionChangeType) {
    /**
     * No permission changes
     */
    PermissionChangeType["NONE"] = "none";
    /**
     * Permissions are broadening
     */
    PermissionChangeType["BROADENING"] = "broadening";
    /**
     * Permissions are changed but not broadening
     */
    PermissionChangeType["NON_BROADENING"] = "non-broadening";
})(PermissionChangeType || (exports.PermissionChangeType = PermissionChangeType = {}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlmZi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wYXlsb2Fkcy9kaWZmLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBOztHQUVHO0FBQ0gsSUFBWSxvQkFlWDtBQWZELFdBQVksb0JBQW9CO0lBQzlCOztPQUVHO0lBQ0gscUNBQWEsQ0FBQTtJQUViOztPQUVHO0lBQ0gsaURBQXlCLENBQUE7SUFFekI7O09BRUc7SUFDSCx5REFBaUMsQ0FBQTtBQUNuQyxDQUFDLEVBZlcsb0JBQW9CLG9DQUFwQixvQkFBb0IsUUFlL0IiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IER1cmF0aW9uIH0gZnJvbSAnLi90eXBlcyc7XG5cbi8qKlxuICogRGlmZmVyZW50IHR5cGVzIG9mIHBlcm1pc3Npb24gcmVsYXRlZCBjaGFuZ2VzIGluIGEgZGlmZlxuICovXG5leHBvcnQgZW51bSBQZXJtaXNzaW9uQ2hhbmdlVHlwZSB7XG4gIC8qKlxuICAgKiBObyBwZXJtaXNzaW9uIGNoYW5nZXNcbiAgICovXG4gIE5PTkUgPSAnbm9uZScsXG5cbiAgLyoqXG4gICAqIFBlcm1pc3Npb25zIGFyZSBicm9hZGVuaW5nXG4gICAqL1xuICBCUk9BREVOSU5HID0gJ2Jyb2FkZW5pbmcnLFxuXG4gIC8qKlxuICAgKiBQZXJtaXNzaW9ucyBhcmUgY2hhbmdlZCBidXQgbm90IGJyb2FkZW5pbmdcbiAgICovXG4gIE5PTl9CUk9BREVOSU5HID0gJ25vbi1icm9hZGVuaW5nJyxcbn1cblxuLyoqXG4gKiBPdXRwdXQgb2YgdGhlIGRpZmYgY29tbWFuZFxuICovXG5leHBvcnQgaW50ZXJmYWNlIERpZmZSZXN1bHQgZXh0ZW5kcyBEdXJhdGlvbiB7XG4gIC8qKlxuICAgKiBTdGFjayBkaWZmIGZvcm1hdHRlZCBhcyBhIHN0cmluZ1xuICAgKi9cbiAgcmVhZG9ubHkgZm9ybWF0dGVkU3RhY2tEaWZmOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGRpZmYgZm9ybWF0dGVkIGFzIGEgc3RyaW5nXG4gICAqL1xuICByZWFkb25seSBmb3JtYXR0ZWRTZWN1cml0eURpZmY6IHN0cmluZztcbn1cbiJdfQ==