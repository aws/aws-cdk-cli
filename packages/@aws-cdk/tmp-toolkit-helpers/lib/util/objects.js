"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyDefaults = applyDefaults;
exports.isEmpty = isEmpty;
exports.deepClone = deepClone;
exports.mapObject = mapObject;
exports.makeObject = makeObject;
exports.deepGet = deepGet;
exports.deepSet = deepSet;
exports.deepMerge = deepMerge;
exports.splitBySize = splitBySize;
exports.transformObjectKeys = transformObjectKeys;
const types_1 = require("./types");
const toolkit_error_1 = require("../api/toolkit-error");
/**
 * Return a new object by adding missing keys into another object
 */
function applyDefaults(hash, defaults) {
    const result = {};
    Object.keys(hash).forEach(k => result[k] = hash[k]);
    Object.keys(defaults)
        .filter(k => !(k in result))
        .forEach(k => result[k] = defaults[k]);
    return result;
}
/**
 * Return whether the given parameter is an empty object or empty list.
 */
function isEmpty(x) {
    if (x == null) {
        return false;
    }
    if ((0, types_1.isArray)(x)) {
        return x.length === 0;
    }
    return Object.keys(x).length === 0;
}
/**
 * Deep clone a tree of objects, lists or scalars
 *
 * Does not support cycles.
 */
function deepClone(x) {
    if (typeof x === 'undefined') {
        return undefined;
    }
    if (x === null) {
        return null;
    }
    if ((0, types_1.isArray)(x)) {
        return x.map(deepClone);
    }
    if ((0, types_1.isObject)(x)) {
        return makeObject(mapObject(x, (k, v) => [k, deepClone(v)]));
    }
    return x;
}
/**
 * Map over an object, treating it as a dictionary
 */
function mapObject(x, fn) {
    const ret = [];
    Object.keys(x).forEach(key => {
        ret.push(fn(key, x[key]));
    });
    return ret;
}
/**
 * Construct an object from a list of (k, v) pairs
 */
function makeObject(pairs) {
    const ret = {};
    for (const pair of pairs) {
        ret[pair[0]] = pair[1];
    }
    return ret;
}
/**
 * Deep get a value from a tree of nested objects
 *
 * Returns undefined if any part of the path was unset or
 * not an object.
 */
function deepGet(x, path) {
    path = path.slice();
    while (path.length > 0 && (0, types_1.isObject)(x)) {
        const key = path.shift();
        x = x[key];
    }
    return path.length === 0 ? x : undefined;
}
/**
 * Deep set a value in a tree of nested objects
 *
 * Throws an error if any part of the path is not an object.
 */
function deepSet(x, path, value) {
    path = path.slice();
    if (path.length === 0) {
        throw new toolkit_error_1.ToolkitError('Path may not be empty');
    }
    while (path.length > 1 && (0, types_1.isObject)(x)) {
        const key = path.shift();
        if (isPrototypePollutingKey(key)) {
            continue;
        }
        if (!(key in x)) {
            x[key] = {};
        }
        x = x[key];
    }
    if (!(0, types_1.isObject)(x)) {
        throw new toolkit_error_1.ToolkitError(`Expected an object, got '${x}'`);
    }
    const finalKey = path[0];
    if (isPrototypePollutingKey(finalKey)) {
        return;
    }
    if (value !== undefined) {
        x[finalKey] = value;
    }
    else {
        delete x[finalKey];
    }
}
/**
 * Helper to detect prototype polluting keys
 *
 * A key matching this, MUST NOT be used in an assignment.
 * Use this to check user-input.
 */
function isPrototypePollutingKey(key) {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
/**
 * Recursively merge objects together
 *
 * The leftmost object is mutated and returned. Arrays are not merged
 * but overwritten just like scalars.
 *
 * If an object is merged into a non-object, the non-object is lost.
 */
function deepMerge(...objects) {
    function mergeOne(target, source) {
        for (const key of Object.keys(source)) {
            if (isPrototypePollutingKey(key)) {
                continue;
            }
            const value = source[key];
            if ((0, types_1.isObject)(value)) {
                if (!(0, types_1.isObject)(target[key])) {
                    target[key] = {};
                } // Overwrite on purpose
                mergeOne(target[key], value);
            }
            else if (typeof value !== 'undefined') {
                target[key] = value;
            }
        }
    }
    const others = objects.filter(x => x != null);
    if (others.length === 0) {
        return {};
    }
    const into = others.splice(0, 1)[0];
    others.forEach(other => mergeOne(into, other));
    return into;
}
/**
 * Splits the given object into two, such that:
 *
 * 1. The size of the first object (after stringified in UTF-8) is less than or equal to the provided size limit.
 * 2. Merging the two objects results in the original one.
 */
function splitBySize(data, maxSizeBytes) {
    if (maxSizeBytes < 2) {
        // It's impossible to fit anything in the first object
        return [undefined, data];
    }
    const entries = Object.entries(data);
    return recurse(0, 0);
    function recurse(index, runningTotalSize) {
        if (index >= entries.length) {
            // Everything fits in the first object
            return [data, undefined];
        }
        const size = runningTotalSize + entrySize(entries[index]);
        return (size > maxSizeBytes) ? cutAt(index) : recurse(index + 1, size);
    }
    function entrySize(entry) {
        return Buffer.byteLength(JSON.stringify(Object.fromEntries([entry])));
    }
    function cutAt(index) {
        return [
            Object.fromEntries(entries.slice(0, index)),
            Object.fromEntries(entries.slice(index)),
        ];
    }
}
/**
 * This function transforms all keys (recursively) in the provided `val` object.
 *
 * @param val The object whose keys need to be transformed.
 * @param transform The function that will be applied to each key.
 * @param exclude The keys that will not be transformed and copied to output directly
 * @returns A new object with the same values as `val`, but with all keys transformed according to `transform`.
 */
function transformObjectKeys(val, transform, exclude = {}) {
    if (val == null || typeof val !== 'object') {
        return val;
    }
    if (Array.isArray(val)) {
        // For arrays we just pass parent's exclude object directly
        // since it makes no sense to specify different exclude options for each array element
        return val.map((input) => transformObjectKeys(input, transform, exclude));
    }
    const ret = {};
    for (const [k, v] of Object.entries(val)) {
        const childExclude = exclude[k];
        if (childExclude === true) {
            // we don't transform this object if the key is specified in exclude
            ret[transform(k)] = v;
        }
        else {
            ret[transform(k)] = transformObjectKeys(v, transform, childExclude);
        }
    }
    return ret;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JqZWN0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlsL29iamVjdHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFPQSxzQ0FVQztBQUtELDBCQVFDO0FBT0QsOEJBY0M7QUFLRCw4QkFNQztBQUtELGdDQU1DO0FBUUQsMEJBUUM7QUFPRCwwQkFtQ0M7QUFvQkQsOEJBNkJDO0FBUUQsa0NBNEJDO0FBWUQsa0RBb0JDO0FBdlBELG1DQUE0QztBQUM1Qyx3REFBb0Q7QUFFcEQ7O0dBRUc7QUFDSCxTQUFnQixhQUFhLENBQUMsSUFBUyxFQUFFLFFBQWE7SUFDcEQsTUFBTSxNQUFNLEdBQVEsRUFBRyxDQUFDO0lBRXhCLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRXBELE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO1NBQ2xCLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksTUFBTSxDQUFDLENBQUM7U0FDM0IsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRXpDLE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLE9BQU8sQ0FBQyxDQUFNO0lBQzVCLElBQUksQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ2QsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBQ0QsSUFBSSxJQUFBLGVBQU8sRUFBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQztJQUN4QixDQUFDO0lBQ0QsT0FBTyxN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T0FBTyxHQUFHLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDM0MsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBQ0QsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDdkIsMkRBQTJEO1FBQzNELHNGQUFzRjtRQUN0RixPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFVLEVBQUUsRUFBRSxDQUFDLG1CQUFtQixDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztJQUNqRixDQUFDO0lBQ0QsTUFBTSxHQUFHLEdBQXlCLEVBQUUsQ0FBQztJQUNyQyxLQUFLLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3pDLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNoQyxJQUFJLFlBQVksS0FBSyxJQUFJLEVBQUUsQ0FBQztZQUMxQixvRUFBb0U7WUFDcEUsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN4QixDQUFDO2FBQU0sQ0FBQztZQUNOLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxtQkFBbUIsQ0FBQyxDQUFDLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBQ3RFLENBQUM7SUFDSCxDQUFDO0lBQ0QsT0FBTyxHQUFHLENBQUM7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBPYmogfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IGlzQXJyYXksIGlzT2JqZWN0IH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi9hcGkvdG9vbGtpdC1lcnJvcic7XG5cbi8qKlxuICogUmV0dXJuIGEgbmV3IG9iamVjdCBieSBhZGRpbmcgbWlzc2luZyBrZXlzIGludG8gYW5vdGhlciBvYmplY3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdHMoaGFzaDogYW55LCBkZWZhdWx0czogYW55KSB7XG4gIGNvbnN0IHJlc3VsdDogYW55ID0geyB9O1xuXG4gIE9iamVjdC5rZXlzKGhhc2gpLmZvckVhY2goayA9PiByZXN1bHRba10gPSBoYXNoW2tdKTtcblxuICBPYmplY3Qua2V5cyhkZWZhdWx0cylcbiAgICAuZmlsdGVyKGsgPT4gIShrIGluIHJlc3VsdCkpXG4gICAgLmZvckVhY2goayA9PiByZXN1bHRba10gPSBkZWZhdWx0c1trXSk7XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBSZXR1cm4gd2hldGhlciB0aGUgZ2l2ZW4gcGFyYW1ldGVyIGlzIGFuIGVtcHR5IG9iamVjdCBvciBlbXB0eSBsaXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eSh4OiBhbnkpIHtcbiAgaWYgKHggPT0gbnVsbCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAoaXNBcnJheSh4KSkge1xuICAgIHJldHVybiB4Lmxlbmd0aCA9PT0gMDtcbiAgfVxuICByZXR1cm4gT2JqZWN0LmtleXMoeCkubGVuZ3RoID09PSAwO1xufVxuXG4vKipcbiAqIERlZXAgY2xvbmUgYSB0cmVlIG9mIG9iamVjdHMsIGxpc3RzIG9yIHNjYWxhcnNcbiAqXG4gKiBEb2VzIG5vdCBzdXBwb3J0IGN5Y2xlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZXBDbG9uZSh4OiBhbnkpOiBhbnkge1xuICBpZiAodHlwZW9mIHggPT09ICd1bmRlZmluZWQnKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoeCA9PT0gbnVsbCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmIChpc0FycmF5KHgpKSB7XG4gICAgcmV0dXJuIHgubWFwKGRlZXBDbG9uZSk7XG4gIH1cbiAgaWYgKGlzT2JqZWN0KHgpKSB7XG4gICAgcmV0dXJuIG1ha2VPYmplY3QobWFwT2JqZWN0KHgsIChrLCB2KSA9PiBbaywgZGVlcENsb25lKHYpXSBhcyBbc3RyaW5nLCBhbnldKSk7XG4gIH1cbiAgcmV0dXJuIHg7XG59XG5cbi8qKlxuICogTWFwIG92ZXIgYW4gb2JqZWN0LCB0cmVhdGluZyBpdCBhcyBhIGRpY3Rpb25hcnlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hcE9iamVjdDxULCBVPih4OiBPYmo8VD4sIGZuOiAoa2V5OiBzdHJpbmcsIHZhbHVlOiBUKSA9PiBVKTogVVtdIHtcbiAgY29uc3QgcmV0OiBVW10gPSBbXTtcbiAgT2JqZWN0LmtleXMoeCkuZm9yRWFjaChrZXkgPT4ge1xuICAgIHJldC5wdXNoKGZuKGtleSwgeFtrZXldKSk7XG4gIH0pO1xuICByZXR1cm4gcmV0O1xufVxuXG4vKipcbiAqIENvbnN0cnVjdCBhbiBvYmplY3QgZnJvbSBhIGxpc3Qgb2YgKGssIHYpIHBhaXJzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlT2JqZWN0PFQ+KHBhaXJzOiBBcnJheTxbc3RyaW5nLCBUXT4pOiBPYmo8VD4ge1xuICBjb25zdCByZXQ6IE9iajxUPiA9IHt9O1xuICBmb3IgKGNvbnN0IHBhaXIgb2YgcGFpcnMpIHtcbiAgICByZXRbcGFpclswXV0gPSBwYWlyWzFdO1xuICB9XG4gIHJldHVybiByZXQ7XG59XG5cbi8qKlxuICogRGVlcCBnZXQgYSB2YWx1ZSBmcm9tIGEgdHJlZSBvZiBuZXN0ZWQgb2JqZWN0c1xuICpcbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmIGFueSBwYXJ0IG9mIHRoZSBwYXRoIHdhcyB1bnNldCBvclxuICogbm90IGFuIG9iamVjdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZXBHZXQoeDogYW55LCBwYXRoOiBzdHJpbmdbXSk6IGFueSB7XG4gIHBhdGggPSBwYXRoLnNsaWNlKCk7XG5cbiAgd2hpbGUgKHBhdGgubGVuZ3RoID4gMCAmJiBpc09iamVjdCh4KSkge1xuICAgIGNvbnN0IGtleSA9IHBhdGguc2hpZnQoKSE7XG4gICAgeCA9IHhba2V5XTtcbiAgfVxuICByZXR1cm4gcGF0aC5sZW5ndGggPT09IDAgPyB4IDogdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIERlZXAgc2V0IGEgdmFsdWUgaW4gYSB0cmVlIG9mIG5lc3RlZCBvYmplY3RzXG4gKlxuICogVGhyb3dzIGFuIGVycm9yIGlmIGFueSBwYXJ0IG9mIHRoZSBwYXRoIGlzIG5vdCBhbiBvYmplY3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWVwU2V0KHg6IGFueSwgcGF0aDogc3RyaW5nW10sIHZhbHVlOiBhbnkpIHtcbiAgcGF0aCA9IHBhdGguc2xpY2UoKTtcblxuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKCdQYXRoIG1heSBub3QgYmUgZW1wdHknKTtcbiAgfVxuXG4gIHdoaWxlIChwYXRoLmxlbmd0aCA+IDEgJiYgaXNPYmplY3QoeCkpIHtcbiAgICBjb25zdCBrZXkgPSBwYXRoLnNoaWZ0KCkhO1xuXG4gICAgaWYgKGlzUHJvdG90eXBlUG9sbHV0aW5nS2V5KGtleSkpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICghKGtleSBpbiB4KSkge1xuICAgICAgeFtrZXldID0ge307XG4gICAgfVxuICAgIHggPSB4W2tleV07XG4gIH1cblxuICBpZiAoIWlzT2JqZWN0KHgpKSB7XG4gICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgRXhwZWN0ZWQgYW4gb2JqZWN0LCBnb3QgJyR7eH0nYCk7XG4gIH1cblxuICBjb25zdCBmaW5hbEtleSA9IHBhdGhbMF07XG5cbiAgaWYgKGlzUHJvdG90eXBlUG9sbHV0aW5nS2V5KGZpbmFsS2V5KSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgeFtmaW5hbEtleV0gPSB2YWx1ZTtcbiAgfSBlbHNlIHtcbiAgICBkZWxldGUgeFtmaW5hbEtleV07XG4gIH1cbn1cblxuLyoqXG4gKiBIZWxwZXIgdG8gZGV0ZWN0IHByb3RvdHlwZSBwb2xsdXRpbmcga2V5c1xuICpcbiAqIEEga2V5IG1hdGNoaW5nIHRoaXMsIE1VU1QgTk9UIGJlIHVzZWQgaW4gYW4gYXNzaWdubWVudC5cbiAqIFVzZSB0aGlzIHRvIGNoZWNrIHVzZXItaW5wdXQuXG4gKi9cbmZ1bmN0aW9uIGlzUHJvdG90eXBlUG9sbHV0aW5nS2V5KGtleTogc3RyaW5nKSB7XG4gIHJldHVybiBrZXkgPT09ICdfX3Byb3RvX18nIHx8IGtleSA9PT0gJ2NvbnN0cnVjdG9yJyB8fCBrZXkgPT09ICdwcm90b3R5cGUnO1xufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IG1lcmdlIG9iamVjdHMgdG9nZXRoZXJcbiAqXG4gKiBUaGUgbGVmdG1vc3Qgb2JqZWN0IGlzIG11dGF0ZWQgYW5kIHJldHVybmVkLiBBcnJheXMgYXJlIG5vdCBtZXJnZWRcbiAqIGJ1dCBvdmVyd3JpdHRlbiBqdXN0IGxpa2Ugc2NhbGFycy5cbiAqXG4gKiBJZiBhbiBvYmplY3QgaXMgbWVyZ2VkIGludG8gYSBub24tb2JqZWN0LCB0aGUgbm9uLW9iamVjdCBpcyBsb3N0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVlcE1lcmdlKC4uLm9iamVjdHM6IEFycmF5PE9iajxhbnk+IHwgdW5kZWZpbmVkPikge1xuICBmdW5jdGlvbiBtZXJnZU9uZSh0YXJnZXQ6IE9iajxhbnk+LCBzb3VyY2U6IE9iajxhbnk+KSB7XG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoc291cmNlKSkge1xuICAgICAgaWYgKGlzUHJvdG90eXBlUG9sbHV0aW5nS2V5KGtleSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gc291cmNlW2tleV07XG5cbiAgICAgIGlmIChpc09iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgaWYgKCFpc09iamVjdCh0YXJnZXRba2V5XSkpIHtcbiAgICAgICAgICB0YXJnZXRba2V5XSA9IHt9O1xuICAgICAgICB9IC8vIE92ZXJ3cml0ZSBvbiBwdXJwb3NlXG4gICAgICAgIG1lcmdlT25lKHRhcmdldFtrZXldLCB2YWx1ZSk7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgdGFyZ2V0W2tleV0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBvdGhlcnMgPSBvYmplY3RzLmZpbHRlcih4ID0+IHggIT0gbnVsbCkgYXMgQXJyYXk8T2JqPGFueT4+O1xuXG4gIGlmIChvdGhlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGNvbnN0IGludG8gPSBvdGhlcnMuc3BsaWNlKDAsIDEpWzBdO1xuXG4gIG90aGVycy5mb3JFYWNoKG90aGVyID0+IG1lcmdlT25lKGludG8sIG90aGVyKSk7XG4gIHJldHVybiBpbnRvO1xufVxuXG4vKipcbiAqIFNwbGl0cyB0aGUgZ2l2ZW4gb2JqZWN0IGludG8gdHdvLCBzdWNoIHRoYXQ6XG4gKlxuICogMS4gVGhlIHNpemUgb2YgdGhlIGZpcnN0IG9iamVjdCAoYWZ0ZXIgc3RyaW5naWZpZWQgaW4gVVRGLTgpIGlzIGxlc3MgdGhhbiBvciBlcXVhbCB0byB0aGUgcHJvdmlkZWQgc2l6ZSBsaW1pdC5cbiAqIDIuIE1lcmdpbmcgdGhlIHR3byBvYmplY3RzIHJlc3VsdHMgaW4gdGhlIG9yaWdpbmFsIG9uZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0QnlTaXplKGRhdGE6IGFueSwgbWF4U2l6ZUJ5dGVzOiBudW1iZXIpOiBbYW55LCBhbnldIHtcbiAgaWYgKG1heFNpemVCeXRlcyA8IDIpIHtcbiAgICAvLyBJdCdzIGltcG9zc2libGUgdG8gZml0IGFueXRoaW5nIGluIHRoZSBmaXJzdCBvYmplY3RcbiAgICByZXR1cm4gW3VuZGVmaW5lZCwgZGF0YV07XG4gIH1cbiAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGRhdGEpO1xuICByZXR1cm4gcmVjdXJzZSgwLCAwKTtcblxuICBmdW5jdGlvbiByZWN1cnNlKGluZGV4OiBudW1iZXIsIHJ1bm5pbmdUb3RhbFNpemU6IG51bWJlcik6IFthbnksIGFueV0ge1xuICAgIGlmIChpbmRleCA+PSBlbnRyaWVzLmxlbmd0aCkge1xuICAgICAgLy8gRXZlcnl0aGluZyBmaXRzIGluIHRoZSBmaXJzdCBvYmplY3RcbiAgICAgIHJldHVybiBbZGF0YSwgdW5kZWZpbmVkXTtcbiAgICB9XG5cbiAgICBjb25zdCBzaXplID0gcnVubmluZ1RvdGFsU2l6ZSArIGVudHJ5U2l6ZShlbnRyaWVzW2luZGV4XSk7XG4gICAgcmV0dXJuIChzaXplID4gbWF4U2l6ZUJ5dGVzKSA/IGN1dEF0KGluZGV4KSA6IHJlY3Vyc2UoaW5kZXggKyAxLCBzaXplKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGVudHJ5U2l6ZShlbnRyeTogW3N0cmluZywgdW5rbm93bl0pIHtcbiAgICByZXR1cm4gQnVmZmVyLmJ5dGVMZW5ndGgoSlNPTi5zdHJpbmdpZnkoT2JqZWN0LmZyb21FbnRyaWVzKFtlbnRyeV0pKSk7XG4gIH1cblxuICBmdW5jdGlvbiBjdXRBdChpbmRleDogbnVtYmVyKTogW2FueSwgYW55XSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIE9iamVjdC5mcm9tRW50cmllcyhlbnRyaWVzLnNsaWNlKDAsIGluZGV4KSksXG4gICAgICBPYmplY3QuZnJvbUVudHJpZXMoZW50cmllcy5zbGljZShpbmRleCkpLFxuICAgIF07XG4gIH1cbn1cblxudHlwZSBFeGNsdWRlID0geyBba2V5OiBzdHJpbmddOiBFeGNsdWRlIHwgdHJ1ZSB9O1xuXG4vKipcbiAqIFRoaXMgZnVuY3Rpb24gdHJhbnNmb3JtcyBhbGwga2V5cyAocmVjdXJzaXZlbHkpIGluIHRoZSBwcm92aWRlZCBgdmFsYCBvYmplY3QuXG4gKlxuICogQHBhcmFtIHZhbCBUaGUgb2JqZWN0IHdob3NlIGtleXMgbmVlZCB0byBiZSB0cmFuc2Zvcm1lZC5cbiAqIEBwYXJhbSB0cmFuc2Zvcm0gVGhlIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBhcHBsaWVkIHRvIGVhY2gga2V5LlxuICogQHBhcmFtIGV4Y2x1ZGUgVGhlIGtleXMgdGhhdCB3aWxsIG5vdCBiZSB0cmFuc2Zvcm1lZCBhbmQgY29waWVkIHRvIG91dHB1dCBkaXJlY3RseVxuICogQHJldHVybnMgQSBuZXcgb2JqZWN0IHdpdGggdGhlIHNhbWUgdmFsdWVzIGFzIGB2YWxgLCBidXQgd2l0aCBhbGwga2V5cyB0cmFuc2Zvcm1lZCBhY2NvcmRpbmcgdG8gYHRyYW5zZm9ybWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cmFuc2Zvcm1PYmplY3RLZXlzKHZhbDogYW55LCB0cmFuc2Zvcm06IChzdHI6IHN0cmluZykgPT4gc3RyaW5nLCBleGNsdWRlOiBFeGNsdWRlID0ge30pOiBhbnkge1xuICBpZiAodmFsID09IG51bGwgfHwgdHlwZW9mIHZhbCAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gdmFsO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHtcbiAgICAvLyBGb3IgYXJyYXlzIHdlIGp1c3QgcGFzcyBwYXJlbnQncyBleGNsdWRlIG9iamVjdCBkaXJlY3RseVxuICAgIC8vIHNpbmNlIGl0IG1ha2VzIG5vIHNlbnNlIHRvIHNwZWNpZnkgZGlmZmVyZW50IGV4Y2x1ZGUgb3B0aW9ucyBmb3IgZWFjaCBhcnJheSBlbGVtZW50XG4gICAgcmV0dXJuIHZhbC5tYXAoKGlucHV0OiBhbnkpID0+IHRyYW5zZm9ybU9iamVjdEtleXMoaW5wdXQsIHRyYW5zZm9ybSwgZXhjbHVkZSkpO1xuICB9XG4gIGNvbnN0IHJldDogeyBbazogc3RyaW5nXTogYW55IH0gPSB7fTtcbiAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXModmFsKSkge1xuICAgIGNvbnN0IGNoaWxkRXhjbHVkZSA9IGV4Y2x1ZGVba107XG4gICAgaWYgKGNoaWxkRXhjbHVkZSA9PT0gdHJ1ZSkge1xuICAgICAgLy8gd2UgZG9uJ3QgdHJhbnNmb3JtIHRoaXMgb2JqZWN0IGlmIHRoZSBrZXkgaXMgc3BlY2lmaWVkIGluIGV4Y2x1ZGVcbiAgICAgIHJldFt0cmFuc2Zvcm0oayldID0gdjtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0W3RyYW5zZm9ybShrKV0gPSB0cmFuc2Zvcm1PYmplY3RLZXlzKHYsIHRyYW5zZm9ybSwgY2hpbGRFeGNsdWRlKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJldDtcbn1cbiJdfQ==