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
