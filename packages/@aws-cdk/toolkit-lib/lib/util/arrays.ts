/**
 * Map a function over an array and concatenate the results
 */
export function flatMap<T, U>(xs: T[], fn: ((x: T, i: number) => U[])): U[] {
  return flatten(xs.map(fn));
}

/**
 * Flatten a list of lists into a list of elements
 */
export function flatten<T>(xs: T[][]): T[] {
  return Array.prototype.concat.apply([], xs);
}

/**
 * Partition a collection by removing and returning all elements that match a predicate
 *
 * Note: the input collection is modified in-place!
 */
export function partition<T>(collection: T[], pred: (x: T) => boolean): T[] {
  const ret: T[] = [];
  let i = 0;
  while (i < collection.length) {
    if (pred(collection[i])) {
      ret.push(collection.splice(i, 1)[0]);
    } else {
      i++;
    }
  }
  return ret;
}

export async function indexBy<A, B>(xs: A[], fn: (a: A) => Promise<B>): Promise<Map<B, A[]>> {
  const ret = new Map<B, A[]>();
  for (const x of xs) {
    const key = await fn(x);
    const group = ret.get(key);
    if (group) {
      group.push(x);
    } else {
      ret.set(key, [x]);
    }
  }
  return ret;
}

export function sortByKey<A>(xs: A[], keyFn: (x: A) => Array<string | number>) {
  xs.sort((a, b) => cmp(keyFn(a), keyFn(b)));

  function cmp(as: Array<string | number>, bs: Array<string | number>): number {
    for (let i = 0; i < as.length && i < bs.length; i++) {
      const a = as[i];
      const b = bs[i];
      if (typeof a !== typeof b) {
        return (typeof a).localeCompare(typeof b);
      }
      if (a !== b) {
        if (typeof a === 'number' && typeof b === 'number') {
          return a - b;
        }
        if (typeof a === 'string' && typeof b === 'string') {
          return a.localeCompare(b);
        }
      }
    }
    return as.length - bs.length;
  }
}
