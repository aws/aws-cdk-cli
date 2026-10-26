/**
 * Helpers for mapping over undefined values
 *
 * We have so many of them in this code base that this gets rid of repetitive undefined checks.
 */

export function umap<T, U>(value: T | undefined, fn: (value: T) => U): U | undefined {
  return value === undefined ? undefined : fn(value);
}
