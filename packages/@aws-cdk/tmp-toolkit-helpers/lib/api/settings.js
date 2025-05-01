"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Settings = exports.TRANSIENT_CONTEXT_KEY = void 0;
const os = require("os");
const fs_path = require("path");
const fs = require("fs-extra");
const toolkit_error_1 = require("./toolkit-error");
const util = require("../util");
/**
 * If a context value is an object with this key set to a truthy value, it won't be saved to cdk.context.json
 */
exports.TRANSIENT_CONTEXT_KEY = '$dontSaveContext';
/**
 * A single bag of settings
 */
class Settings {
    settings;
    readOnly;
    static mergeAll(...settings) {
        let ret = new Settings();
        for (const setting of settings) {
            ret = ret.merge(setting);
        }
        return ret;
    }
    constructor(settings = {}, readOnly = false) {
        this.settings = settings;
        this.readOnly = readOnly;
    }
    async save(fileName) {
        const expanded = expandHomeDir(fileName);
        await fs.writeJson(expanded, stripTransientValues(this.settings), {
            spaces: 2,
        });
        return this;
    }
    get all() {
        return this.get([]);
    }
    merge(other) {
        return new Settings(util.deepMerge(this.settings, other.settings));
    }
    subSettings(keyPrefix) {
        return new Settings(this.get(keyPrefix) || {}, false);
    }
    makeReadOnly() {
        return new Settings(this.settings, true);
    }
    clear() {
        if (this.readOnly) {
            throw new toolkit_error_1.ToolkitError('Cannot clear(): settings are readonly');
        }
        this.settings = {};
    }
    get empty() {
        return Object.keys(this.settings).length === 0;
    }
    get(path) {
        return util.deepClone(util.deepGet(this.settings, path));
    }
    set(path, value) {
        if (this.readOnly) {
            throw new toolkit_error_1.ToolkitError(`Can't set ${path}: settings object is readonly`);
        }
        if (path.length === 0) {
            // deepSet can't handle this case
            this.settings = value;
        }
        else {
            util.deepSet(this.settings, path, value);
        }
        return this;
    }
    unset(path) {
        this.set(path, undefined);
    }
}
exports.Settings = Settings;
function expandHomeDir(x) {
    if (x.startsWith('~')) {
        return fs_path.join(os.homedir(), x.slice(1));
    }
    return x;
}
/**
 * Return all context value that are not transient context values
 */
function stripTransientValues(obj) {
    const ret = {};
    for (const [key, value] of Object.entries(obj)) {
        if (!isTransientValue(value)) {
            ret[key] = value;
        }
    }
    return ret;
}
/**
 * Return whether the given value is a transient context value
 *
 * Values that are objects with a magic key set to a truthy value are considered transient.
 */
function isTransientValue(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value[exports.TRANSIENT_CONTEXT_KEY]);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2V0dGluZ3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvYXBpL3NldHRpbmdzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHlCQUF5QjtBQUN6QixnQ0FBZ0M7QUFDaEMsK0JBQStCO0FBQy9CLG1EQUErQztBQUMvQyxnQ0FBZ0M7QUFJaEM7O0dBRUc7QUFDVSxRQUFBLHFCQUFxQixHQUFHLGtCQUFrQixDQUFDO0FBRXhEOztHQUVHO0FBQ0gsTUFBYSxRQUFRO0lBVVQ7SUFDUTtJQVZYLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxRQUFvQjtRQUM1QyxJQUFJLEdBQUcsR0FBRyxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQ3pCLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7WUFDL0IsR0FBRyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDM0IsQ0FBQztRQUNELE9BQU8sR0FBRyxDQUFDO0lBQ2IsQ0FBQztJQUVELFlBQ1UsV0FBd0IsRUFBRSxFQUNsQixXQUFXLEtBQUs7UUFEeEIsYUFBUSxHQUFSLFFBQVEsQ0FBa0I7UUFDbEIsYUFBUSxHQUFSLFFBQVEsQ0FBUTtJQUVsQyxDQUFDO0lBRU0sS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFnQjtRQUNoQyxNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDekMsTUFBTSxFQUFFLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUU7WUFDaEUsTUFBTSxFQUFFLENBQUM7U0FDVixDQUFDLENBQUM7UUFDSCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCxJQUFXLEdBQUc7UUFDWixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDdEIsQ0FBQztJQUVNLEtBQUssQ0FBQyxLQUFlO1FBQzFCLE9BQU8sSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0lBQ3JFLENBQUM7SUFFTSxXQUFXLENBQUMsU0FBbUI7UUFDcEMsT0FBTyxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUN4RCxDQUFDO0lBRU0sWUFBWTtRQUNqQixPQUFPLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUVNLEtBQUs7UUFDVixJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNsQixNQUFNLElBQUksNEJBQVksQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO1FBQ2xFLENBQUM7UUFDRCxJQUFJLENBQUMsUUFBUSxHQUFHLEVBQUUsQ0FBQztJQUNyQixDQUFDO0lBRUQsSUFBVyxLQUFLO1FBQ2QsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDO0lBQ2pELENBQUM7SUFFTSxHQUFHLENBQUMsSUFBYztRQUN2QixPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDM0QsQ0FBQztJQUVNLEdBQUcsQ0FBQyxJQUFjLEVBQUUsS0FBVTtRQUNuQyxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNsQixNQUFNLElBQUksNEJBQVksQ0FBQyxhQUFhLElBQUksK0JBQStCLENBQUMsQ0FBQztRQUMzRSxDQUFDO1FBQ0QsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3RCLGlDQUFpQztZQUNqQyxJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQztRQUN4QixDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0MsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVNLEtBQUssQ0FBQyxJQUFjO1FBQ3pCLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQzVCLENBQUM7Q0FDRjtBQXRFRCw0QkFzRUM7QUFFRCxTQUFTLGFBQWEsQ0FBQyxDQUFTO0lBQzlCLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3RCLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFDRCxPQUFPLENBQUMsQ0FBQztBQUNYLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsb0JBQW9CLENBQUMsR0FBMkI7SUFDdkQsTUFBTSxHQUFHLEdBQVEsRUFBRSxDQUFDO0lBQ3BCLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDL0MsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDN0IsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQztRQUNuQixDQUFDO0lBQ0gsQ0FBQztJQUNELE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGdCQUFnQixDQUFDLEtBQVU7SUFDbEMsT0FBTyxDQUNMLE9BQU8sS0FBSyxLQUFLLFFBQVE7UUFDekIsS0FBSyxLQUFLLElBQUk7UUFDYixLQUFhLENBQUMsNkJBQXFCLENBQUMsQ0FDdEMsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgKiBhcyBmc19wYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0IHsgVG9vbGtpdEVycm9yIH0gZnJvbSAnLi90b29sa2l0LWVycm9yJztcbmltcG9ydCAqIGFzIHV0aWwgZnJvbSAnLi4vdXRpbCc7XG5cbmV4cG9ydCB0eXBlIFNldHRpbmdzTWFwID0geyBba2V5OiBzdHJpbmddOiBhbnkgfTtcblxuLyoqXG4gKiBJZiBhIGNvbnRleHQgdmFsdWUgaXMgYW4gb2JqZWN0IHdpdGggdGhpcyBrZXkgc2V0IHRvIGEgdHJ1dGh5IHZhbHVlLCBpdCB3b24ndCBiZSBzYXZlZCB0byBjZGsuY29udGV4dC5qc29uXG4gKi9cbmV4cG9ydCBjb25zdCBUUkFOU0lFTlRfQ09OVEVYVF9LRVkgPSAnJGRvbnRTYXZlQ29udGV4dCc7XG5cbi8qKlxuICogQSBzaW5nbGUgYmFnIG9mIHNldHRpbmdzXG4gKi9cbmV4cG9ydCBjbGFzcyBTZXR0aW5ncyB7XG4gIHB1YmxpYyBzdGF0aWMgbWVyZ2VBbGwoLi4uc2V0dGluZ3M6IFNldHRpbmdzW10pOiBTZXR0aW5ncyB7XG4gICAgbGV0IHJldCA9IG5ldyBTZXR0aW5ncygpO1xuICAgIGZvciAoY29uc3Qgc2V0dGluZyBvZiBzZXR0aW5ncykge1xuICAgICAgcmV0ID0gcmV0Lm1lcmdlKHNldHRpbmcpO1xuICAgIH1cbiAgICByZXR1cm4gcmV0O1xuICB9XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSBzZXR0aW5nczogU2V0dGluZ3NNYXAgPSB7fSxcbiAgICBwdWJsaWMgcmVhZG9ubHkgcmVhZE9ubHkgPSBmYWxzZSxcbiAgKSB7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc2F2ZShmaWxlTmFtZTogc3RyaW5nKTogUHJvbWlzZTx0aGlzPiB7XG4gICAgY29uc3QgZXhwYW5kZWQgPSBleHBhbmRIb21lRGlyKGZpbGVOYW1lKTtcbiAgICBhd2FpdCBmcy53cml0ZUpzb24oZXhwYW5kZWQsIHN0cmlwVHJhbnNpZW50VmFsdWVzKHRoaXMuc2V0dGluZ3MpLCB7XG4gICAgICBzcGFjZXM6IDIsXG4gICAgfSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGFsbCgpOiBhbnkge1xuICAgIHJldHVybiB0aGlzLmdldChbXSk7XG4gIH1cblxuICBwdWJsaWMgbWVyZ2Uob3RoZXI6IFNldHRpbmdzKTogU2V0dGluZ3Mge1xuICAgIHJldHVybiBuZXcgU2V0dGluZ3ModXRpbC5kZWVwTWVyZ2UodGhpcy5zZXR0aW5ncywgb3RoZXIuc2V0dGluZ3MpKTtcbiAgfVxuXG4gIHB1YmxpYyBzdWJTZXR0aW5ncyhrZXlQcmVmaXg6IHN0cmluZ1tdKSB7XG4gICAgcmV0dXJuIG5ldyBTZXR0aW5ncyh0aGlzLmdldChrZXlQcmVmaXgpIHx8IHt9LCBmYWxzZSk7XG4gIH1cblxuICBwdWJsaWMgbWFrZVJlYWRPbmx5KCk6IFNldHRpbmdzIHtcbiAgICByZXR1cm4gbmV3IFNldHRpbmdzKHRoaXMuc2V0dGluZ3MsIHRydWUpO1xuICB9XG5cbiAgcHVibGljIGNsZWFyKCkge1xuICAgIGlmICh0aGlzLnJlYWRPbmx5KSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKCdDYW5ub3QgY2xlYXIoKTogc2V0dGluZ3MgYXJlIHJlYWRvbmx5Jyk7XG4gICAgfVxuICAgIHRoaXMuc2V0dGluZ3MgPSB7fTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgZW1wdHkoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuc2V0dGluZ3MpLmxlbmd0aCA9PT0gMDtcbiAgfVxuXG4gIHB1YmxpYyBnZXQocGF0aDogc3RyaW5nW10pOiBhbnkge1xuICAgIHJldHVybiB1dGlsLmRlZXBDbG9uZSh1dGlsLmRlZXBHZXQodGhpcy5zZXR0aW5ncywgcGF0aCkpO1xuICB9XG5cbiAgcHVibGljIHNldChwYXRoOiBzdHJpbmdbXSwgdmFsdWU6IGFueSk6IFNldHRpbmdzIHtcbiAgICBpZiAodGhpcy5yZWFkT25seSkge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgQ2FuJ3Qgc2V0ICR7cGF0aH06IHNldHRpbmdzIG9iamVjdCBpcyByZWFkb25seWApO1xuICAgIH1cbiAgICBpZiAocGF0aC5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIGRlZXBTZXQgY2FuJ3QgaGFuZGxlIHRoaXMgY2FzZVxuICAgICAgdGhpcy5zZXR0aW5ncyA9IHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICB1dGlsLmRlZXBTZXQodGhpcy5zZXR0aW5ncywgcGF0aCwgdmFsdWUpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHB1YmxpYyB1bnNldChwYXRoOiBzdHJpbmdbXSkge1xuICAgIHRoaXMuc2V0KHBhdGgsIHVuZGVmaW5lZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZXhwYW5kSG9tZURpcih4OiBzdHJpbmcpIHtcbiAgaWYgKHguc3RhcnRzV2l0aCgnficpKSB7XG4gICAgcmV0dXJuIGZzX3BhdGguam9pbihvcy5ob21lZGlyKCksIHguc2xpY2UoMSkpO1xuICB9XG4gIHJldHVybiB4O1xufVxuXG4vKipcbiAqIFJldHVybiBhbGwgY29udGV4dCB2YWx1ZSB0aGF0IGFyZSBub3QgdHJhbnNpZW50IGNvbnRleHQgdmFsdWVzXG4gKi9cbmZ1bmN0aW9uIHN0cmlwVHJhbnNpZW50VmFsdWVzKG9iajogeyBba2V5OiBzdHJpbmddOiBhbnkgfSkge1xuICBjb25zdCByZXQ6IGFueSA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvYmopKSB7XG4gICAgaWYgKCFpc1RyYW5zaWVudFZhbHVlKHZhbHVlKSkge1xuICAgICAgcmV0W2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJldDtcbn1cblxuLyoqXG4gKiBSZXR1cm4gd2hldGhlciB0aGUgZ2l2ZW4gdmFsdWUgaXMgYSB0cmFuc2llbnQgY29udGV4dCB2YWx1ZVxuICpcbiAqIFZhbHVlcyB0aGF0IGFyZSBvYmplY3RzIHdpdGggYSBtYWdpYyBrZXkgc2V0IHRvIGEgdHJ1dGh5IHZhbHVlIGFyZSBjb25zaWRlcmVkIHRyYW5zaWVudC5cbiAqL1xuZnVuY3Rpb24gaXNUcmFuc2llbnRWYWx1ZSh2YWx1ZTogYW55KSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgKHZhbHVlIGFzIGFueSlbVFJBTlNJRU5UX0NPTlRFWFRfS0VZXVxuICApO1xufVxuIl19