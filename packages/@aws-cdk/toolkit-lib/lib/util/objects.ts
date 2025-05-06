import type { Obj } from './types';
import { isArray, isObject } from './types';
import { ToolkitError } from '../toolkit/toolkit-error';

/**
 * Return a new object by adding missing keys into another object
 */
export function applyDefaults(hash: any, defaults: any) {
  const result: any = { };

  Object.keys(hash).forEach(k => result[k] = hash[k]);

  Object.keys(defaults)
    .filter(k => !(k in result))
    .forEach(k => result[k] = defaults[k]);

  return result;
}

/**
 * Return whether the given parameter is an empty object or empty list.
 */
export function isEmpty(x: any) {
  if (x == null) {
    return false;
  }
  if (isArray(x)) {
    return x.length === 0;
  }
  return Object.keys(x).length === 0;
}

/**
 * Deep clone a tree of objects, lists or scalars
 *
 * Does not support cycles.
 */
export function deepClone(x: any): any {
  if (typeof x === 'undefined') {
    return undefined;
  }
  if (x === null) {
    return null;
  }
  if (isArray(x)) {
    return x.map(deepClone);
  }
  if (isObject(x)) {
    return makeObject(mapObject(x, (k, v) => [k, deepClone(v)] as [string, any]));
  }
  return x;
}

/**
 * Map over an object, treating it as a dictionary
 */
export function mapObject<T, U>(x: Obj<T>, fn: (key: string, value: T) => U): U[] {
  const ret: U[] = [];
  Object.keys(x).forEach(key => {
    ret.push(fn(key, x[key]));
  });
  return ret;
}

/**
 * Construct an object from a list of (k, v) pairs
 */
export function makeObject<T>(pairs: Array<[string, T]>): Obj<T> {
  const ret: Obj<T> = {};
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
export function deepGet(x: any, path: string[]): any {
  path = path.slice();

  while (path.length > 0 && isObject(x)) {
    const key = path.shift()!;
    x = x[key];
  }
  return path.length === 0 ? x : undefined;
}

/**
 * Deep set a value in a tree of nested objects
 *
 * Throws an error if any part of the path is not an object.
 */
export function deepSet(x: any, path: string[], value: any) {
  path = path.slice();

  if (path.length === 0) {
    throw new ToolkitError('Path may not be empty');
  }

  while (path.length > 1 && isObject(x)) {
    const key = path.shift()!;

    if (isPrototypePollutingKey(key)) {
      continue;
    }

    if (!(key in x)) {
      x[key] = {};
    }
    x = x[key];
  }

  if (!isObject(x)) {
    throw new ToolkitError(`Expected an object, got '${x}'`);
  }

  const finalKey = path[0];

  if (isPrototypePollutingKey(finalKey)) {
    return;
  }

  if (value !== undefined) {
    x[finalKey] = value;
  } else {
    delete x[finalKey];
  }
}

/**
 * Helper to detect prototype polluting keys
 *
 * A key matching this, MUST NOT be used in an assignment.
 * Use this to check user-input.
 */
function isPrototypePollutingKey(key: string) {
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
export function deepMerge(...objects: Array<Obj<any> | undefined>) {
  function mergeOne(target: Obj<any>, source: Obj<any>) {
    for (const key of Object.keys(source)) {
      if (isPrototypePollutingKey(key)) {
        continue;
      }

      const value = source[key];

      if (isObject(value)) {
        if (!isObject(target[key])) {
          target[key] = {};
        } // Overwrite on purpose
        mergeOne(target[key], value);
      } else if (typeof value !== 'undefined') {
        target[key] = value;
      }
    }
  }

  const others = objects.filter(x => x != null) as Array<Obj<any>>;

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
export function splitBySize(data: any, maxSizeBytes: number): [any, any] {
  if (maxSizeBytes < 2) {
    // It's impossible to fit anything in the first object
    return [undefined, data];
  }
  const entries = Object.entries(data);
  return recurse(0, 0);

  function recurse(index: number, runningTotalSize: number): [any, any] {
    if (index >= entries.length) {
      // Everything fits in the first object
      return [data, undefined];
    }

    const size = runningTotalSize + entrySize(entries[index]);
    return (size > maxSizeBytes) ? cutAt(index) : recurse(index + 1, size);
  }

  function entrySize(entry: [string, unknown]) {
    return Buffer.byteLength(JSON.stringify(Object.fromEntries([entry])));
  }

  function cutAt(index: number): [any, any] {
    return [
      Object.fromEntries(entries.slice(0, index)),
      Object.fromEntries(entries.slice(index)),
    ];
  }
}

type Exclude = { [key: string]: Exclude | true };

/**
 * This function transforms all keys (recursively) in the provided `val` object.
 *
 * @param val The object whose keys need to be transformed.
 * @param transform The function that will be applied to each key.
 * @param exclude The keys that will not be transformed and copied to output directly
 * @returns A new object with the same values as `val`, but with all keys transformed according to `transform`.
 */
export function transformObjectKeys(val: any, transform: (str: string) => string, exclude: Exclude = {}): any {
  if (val == null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    // For arrays we just pass parent's exclude object directly
    // since it makes no sense to specify different exclude options for each array element
    return val.map((input: any) => transformObjectKeys(input, transform, exclude));
  }
  const ret: { [k: string]: any } = {};
  for (const [k, v] of Object.entries(val)) {
    const childExclude = exclude[k];
    if (childExclude === true) {
      // we don't transform this object if the key is specified in exclude
      ret[transform(k)] = v;
    } else {
      ret[transform(k)] = transformObjectKeys(v, transform, childExclude);
    }
  }
  return ret;
}
