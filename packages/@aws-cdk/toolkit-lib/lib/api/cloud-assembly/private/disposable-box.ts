/**
 * An async disposable whose disposable value can be prevented from being disposed.
 *
 * This is useful if you are temporarily holding onto a disposable value, and are planning
 * to return it from a function, but want to clean it up if something fails in the middle.
 *
 * The purpose of this class is pretty similar to `DisposableStack`, but this
 * class doesn't depend on the runtime providing that class (Node 24+ only), and
 * `DisposableStack`s "move()" API is awkward.
 *
 * Example:
 *
 * ```ts
 * async function someFunction() {
 *   await using box = new AsyncDisposableBox(someDisposableValue());
 *   // ...
 *   return box.take();
 * }
 * ```
 */
export class AsyncDisposableBox<T extends AsyncDisposable> implements AsyncDisposable {
  private shouldDispose = true;

  constructor(public readonly value: T) {
  }

  /**
   * Remove the value from the Box, preventing it from being disposed in the future.
   *
   * Should be the last line of the containing function.
   */
  public take(): T {
    this.shouldDispose = false;
    return this.value;
  }

  [Symbol.asyncDispose](): PromiseLike<void> {
    if (this.shouldDispose) {
      return this.value[Symbol.asyncDispose]();
    }
    return Promise.resolve();
  }
}
