/**
 * A backport of Promiser.withResolvers
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers
 */
export function promiseWithResolvers<A>(): PromiseAndResolvers<A> {
  let resolve: PromiseAndResolvers<A>['resolve'], reject: PromiseAndResolvers<A>['reject'];
  const promise = new Promise<A>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

interface PromiseAndResolvers<A> {
  promise: Promise<A>;
  resolve: (value: A) => void;
  reject: (reason: any) => void;
}

/**
 * Waits for a function to return non-+undefined+ before returning.
 *
 * @param valueProvider - a function that will return a value that is not +undefined+ once the wait should be over
 * @param timeout     - the time to wait between two calls to +valueProvider+
 *
 * @returns       the value that was returned by +valueProvider+
 */
export async function waitFor<T>(
  valueProvider: () => Promise<T | null | undefined>,
  timeout: number = 5000,
): Promise<T | undefined> {
  while (true) {
    const result = await valueProvider();
    if (result === null) {
      return undefined;
    } else if (result !== undefined) {
      return result;
    }
    await new Promise((cb) => setTimeout(cb, timeout));
  }
}
