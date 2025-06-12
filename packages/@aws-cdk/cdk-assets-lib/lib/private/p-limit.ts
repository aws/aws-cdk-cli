/**
 * A minimal  of p-limit that does not bring in new dependencies, and is not ESM.
 */

type PromiseFactory<A> = () => Promise<A>;

export function pLimit(concurrency: number): PLimit {
  const queue: Array<[PromiseFactory<any>, (x: any) => void, (reason?: any) => void]> = [];
  let activeCount = 0;
  let stopped = false;

  function dispatch() {
    if (activeCount < concurrency && queue.length > 0) {
      const [fac, resolve, reject] = queue.shift()!;
      activeCount++;
      fac().then(
        (r) => {
          // Start a new job before reporting back on the previous one
          resumeNext();
          resolve(r);
        },
        (e) => {
          // Start a new job before reporting back on the previous one
          resumeNext();
          reject(e);
        },
      );
    }
  }

  function resumeNext() {
    activeCount--;
    if (stopped) {
      for (const [_, __, reject] of queue) {
        reject(new Error('Task has been cancelled'));
      }
      queue.splice(0, queue.length);
    }
    dispatch();
  }

  const ret = <A>(promiseFactory: PromiseFactory<A>) => {
    return new Promise<A>((resolve, reject) => {
      queue.push([promiseFactory, resolve, reject]);
      dispatch();
    });
  };
  Object.defineProperties(ret, {
    dispose: {
      value: () => {
        stopped = true;
      },
    },
  });

  return ret as PLimit;
}

interface PLimit {
  dispose(): void;
  <A>(promiseFactory: PromiseFactory<A>): Promise<A>;
}
