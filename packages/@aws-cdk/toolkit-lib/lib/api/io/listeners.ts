import type { IIoHost } from './io-host';
import type { IoMessage, IoMessageLevel, IoRequest } from './io-message';
import { ListenerRegistry } from './private/listener-registry';
import type { MessageListenerResultOrPromise, MessageSelector } from './private/listener-registry';
import type { IoMessageMaker, IoRequestMaker } from './private/message-maker';

// Re-export the listener vocabulary from the shared registry so it is part of
// the public API alongside `withListeners`.
export { matchAny } from './private/listener-registry';
export type { MessageListenerResult, MessageListenerResultOrPromise, MessageSelector } from './private/listener-registry';

/**
 * An `IIoHost` that additionally lets listeners be attached to it.
 *
 * The result of `withListeners`. It is still an `IIoHost`, so it drops straight
 * into the `ioHost` slot of a new `Toolkit`, and it exposes methods to observe,
 * reshape, or answer individual messages without subclassing a host.
 */
export interface IoHostWithListeners extends IIoHost {
  /**
   * Register a listener that is invoked for every message that matches the
   * selector.
   *
   * The listener may return a `MessageListenerResult` to update the message
   * text and/or level or prevent the default handling (asking the wrapped host
   * to write it); returning nothing leaves the message untouched. The listener
   * may be async (return a `Promise`); it is awaited before the message is
   * handled further. Returns a function that removes the listener again.
   *
   * @example
   * ```ts
   * const dispose = host.on(IO.CDK_TOOLKIT_I2901, async (msg) => {
   *   myCount += msg.data.stacks.length;
   *   await persist(myCount);
   * });
   * ```
   *
   * @example
   * ```ts
   * // Match with a custom predicate instead of a code, e.g. a maker's `.is`:
   * const dispose = host.on(IO.CDK_TOOLKIT_I7010.is, (msg) => ({ respond: true }));
   * ```
   */
  on<T>(
    selector: IoMessageMaker<T> | IoRequestMaker<T, any> | ((msg: IoMessage<any>) => msg is IoMessage<T>),
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): () => void;
  on(
    predicate: (msg: IoMessage<any>) => boolean,
    listener: (msg: IoMessage<unknown>) => MessageListenerResultOrPromise,
  ): () => void;

  /**
   * Like `on`, but the listener is automatically removed after it has been
   * invoked once.
   */
  once<T>(
    selector: IoMessageMaker<T> | IoRequestMaker<T, any> | ((msg: IoMessage<any>) => msg is IoMessage<T>),
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): () => void;
  once(
    predicate: (msg: IoMessage<any>) => boolean,
    listener: (msg: IoMessage<unknown>) => MessageListenerResultOrPromise,
  ): () => void;

  /**
   * Register a formatter that replaces the printed text of messages with the
   * given code. This lets a caller define _how_ a toolkit message is presented
   * without the host needing to know about it.
   *
   * Optionally pass a `level` to also override the message's level. Syntactic
   * sugar for an `on` listener that returns the new `message` and `level`.
   * Returns a function that removes the formatter again.
   *
   * @example
   * ```ts
   * const dispose = host.rewrite(IO.CDK_TOOLKIT_I2901, (msg) =>
   *   serializeStructure(msg.data.stacks, true));
   * ```
   */
  rewrite<T>(
    code: IoMessageMaker<T> | IoRequestMaker<T, any>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): () => void;

  /**
   * Like `rewrite`, but the formatter is automatically removed after it has
   * been applied once.
   */
  rewriteOnce<T>(
    code: IoMessageMaker<T> | IoRequestMaker<T, any>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): () => void;

  /**
   * Answer a request (by its code) on the caller's behalf with a fixed value,
   * so the wrapped host is not asked to prompt. Syntactic sugar for an `on`
   * listener that responds with the value and prevents the default; for
   * conditional answers or to also reword the question, use `on`/`once`
   * directly. Returns a function that removes the responder again.
   *
   * @param suppressQuestion - whether to also suppress surfacing the question
   *   text. Defaults to `true` (answer silently). Pass `false` to still surface
   *   the question while answering it.
   *
   * @example
   * ```ts
   * const dispose = host.respond(IO.CDK_TOOLKIT_I7010, true);
   * ```
   */
  respond<T, U>(code: IoRequestMaker<T, U>, value: U, suppressQuestion?: boolean): () => void;

  /**
   * Like `respond`, but the answer is given only once and then removed.
   */
  respondOnce<T, U>(code: IoRequestMaker<T, U>, value: U, suppressQuestion?: boolean): () => void;
}

/**
 * Wrap any `IIoHost` so listeners can be attached to it.
 *
 * The returned host forwards `notify` and `requestResponse` to the host you
 * pass in, running any matching listeners in registration order in between. On
 * `notify` it runs the listeners, applies any rewrite, and skips the wrapped
 * host's write if a listener prevented the default. On `requestResponse` it runs
 * them too, so a listener can rewrite the prompt text or answer it with
 * `respond`, in which case the request resolves without asking the wrapped host.
 *
 * The result is still an `IIoHost`, so it drops straight into a new `Toolkit`.
 * Its lifecycle stays yours: you wrap a host, register listeners, and pass it to
 * the toolkit, all explicit.
 *
 * @example
 * ```ts
 * const base = new NonInteractiveIoHost();     // or your own host
 * const host = withListeners(base);
 * host.on(IO.CDK_TOOLKIT_I2901, (m) => { count += m.data.stacks.length; });
 * const toolkit = new Toolkit({ ioHost: host });
 * ```
 */
export function withListeners(host: IIoHost): IoHostWithListeners {
  return new ListeningIoHost(host);
}

/**
 * An `IIoHost` that runs a `ListenerRegistry` around a wrapped host.
 *
 * The registry is the shared listener engine (also used by the CLI's terminal
 * host); this class adds the wrapped-host plumbing that turns it into an
 * `IIoHost`.
 */
class ListeningIoHost implements IoHostWithListeners {
  private readonly registry = new ListenerRegistry();

  public constructor(private readonly inner: IIoHost) {
  }

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    const { message, preventDefault } = await this.registry.apply(msg);
    if (preventDefault) {
      return;
    }
    return this.inner.notify(message);
  }

  public async requestResponse<T>(msg: IoRequest<unknown, T>): Promise<T> {
    const { message, preventDefault, responded } = await this.registry.apply(msg);

    // A listener suppressed the default handling: resolve with the (possibly
    // overridden) default response without asking the wrapped host.
    if (preventDefault) {
      return message.defaultResponse;
    }

    // A listener answered the request but wants the question surfaced: show it
    // via the wrapped host, then resolve with the answer instead of prompting.
    if (responded) {
      await this.inner.notify(message);
      return message.defaultResponse;
    }

    // No listener answered: let the wrapped host resolve the (possibly reworded)
    // request as it sees fit (it may prompt, or use its own default).
    return this.inner.requestResponse(message);
  }

  public on(selector: MessageSelector<any>, listener: (msg: IoMessage<any>) => MessageListenerResultOrPromise): () => void {
    return this.registry.on(selector as any, listener as any);
  }

  public once(selector: MessageSelector<any>, listener: (msg: IoMessage<any>) => MessageListenerResultOrPromise): () => void {
    return this.registry.once(selector as any, listener as any);
  }

  public rewrite<T>(
    code: IoMessageMaker<T> | IoRequestMaker<T, any>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): () => void {
    return this.registry.rewrite(code, formatter, level);
  }

  public rewriteOnce<T>(
    code: IoMessageMaker<T> | IoRequestMaker<T, any>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): () => void {
    return this.registry.rewriteOnce(code, formatter, level);
  }

  public respond<T, U>(code: IoRequestMaker<T, U>, value: U, suppressQuestion = true): () => void {
    return this.registry.respond(code, value, suppressQuestion);
  }

  public respondOnce<T, U>(code: IoRequestMaker<T, U>, value: U, suppressQuestion = true): () => void {
    return this.registry.respondOnce(code, value, suppressQuestion);
  }
}
