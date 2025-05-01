"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readIfPossible = readIfPossible;
const fs = require("fs-extra");
/**
 * Read a file if it exists, or return undefined
 *
 * Not async because it is used in the constructor
 */
function readIfPossible(filename) {
    try {
        if (!fs.pathExistsSync(filename)) {
            return undefined;
        }
        return fs.readFileSync(filename, { encoding: 'utf-8' });
    }
    catch (e) {
        return undefined;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvYXdzLWF1dGgvdXRpbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQU9BLHdDQVNDO0FBaEJELCtCQUErQjtBQUUvQjs7OztHQUlHO0FBQ0gsU0FBZ0IsY0FBYyxDQUFDLFFBQWdCO0lBQzdDLElBQUksQ0FBQztRQUNILElBQUksQ0FBQyxFQUFFLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDakMsT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQztRQUNELE9BQU8sRUFBRSxDQUFDLFlBQVksQ0FBQyxRQUFRLEVBQUUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztJQUMxRCxDQUFDO0lBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztRQUNoQixPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcblxuLyoqXG4gKiBSZWFkIGEgZmlsZSBpZiBpdCBleGlzdHMsIG9yIHJldHVybiB1bmRlZmluZWRcbiAqXG4gKiBOb3QgYXN5bmMgYmVjYXVzZSBpdCBpcyB1c2VkIGluIHRoZSBjb25zdHJ1Y3RvclxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhZElmUG9zc2libGUoZmlsZW5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHRyeSB7XG4gICAgaWYgKCFmcy5wYXRoRXhpc3RzU3luYyhmaWxlbmFtZSkpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiBmcy5yZWFkRmlsZVN5bmMoZmlsZW5hbWUsIHsgZW5jb2Rpbmc6ICd1dGYtOCcgfSk7XG4gIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbn1cbiJdfQ==