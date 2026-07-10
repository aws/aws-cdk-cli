import type { IIoHost } from './io-host';
import type { IoMessage, IoRequest, IMessageMatcher, IRequestMatcher, IoMessageCode, IoMessageLevel } from './io-message';
import { ListenerRegistry } from './private/listener-registry';
import type { MessageListenerResultOrPromise } from './private/listener-registry';

// Re-export the listener result vocabulary from the shared registry so it is
// part of the public API alongside `withListeners`.
export type { MessageListenerResult, MessageListenerResultOrPromise } from './private/listener-registry';

/**
 * A predicate that decides whether a listener applies to a message.
 *
 * Use one to match a family of messages instead of a single code — e.g. every
 * message of a given level, or any of several codes. It touches only the public
 * `IoMessage` shape.
 *
 * @example
 * ```ts
 * host.on((msg) => msg.level === 'warn', listener);
 * ```
 */
export type MessagePredicate = (msg: IoMessage<unknown>) => boolean;

/**
 * Options for `respond`/ `respondOnce`.
 */
export interface RespondOptions {
  /**
   * Whether also to suppress surfacing the question text.
   * @default true - answer silently
   */
  readonly suppressQuestion?: boolean;
}

/**
 * An `IIoHost` that additionally lets listeners be attached to it.
 *
 * The result of `withListeners`. It is still an `IIoHost`, so it drops straight
 * into the `ioHost` slot of a new `Toolkit`, and it exposes methods to observe,
 * reshape, or answer individual messages without subclassing a host.
 *
 * Listeners are keyed on a message `code` (e.g. `'CDK_TOOLKIT_I2901'`). The
 * codes are listed in the message registry:
 * https://docs.aws.amazon.com/cdk/api/toolkit-lib/message-registry/
 */
export interface IoHostWithListeners extends IIoHost {
  /**
   * Register a listener that is invoked for every message that matches — either
   * a single message `code` (e.g. `'CDK_TOOLKIT_I2901'`), or a
   * `MessagePredicate` that matches a family of messages.
   *
   * The listener may return a `MessageListenerResult` to update the message
   * text and/or level or prevent the default handling (asking the wrapped host
   * to write it); returning nothing leaves the message untouched. The listener
   * may be async (return a `Promise`); it is awaited before the message is
   * handled further. Returns a function that removes the listener again.
   *
   * The message payload is delivered as `unknown`; see the message registry for
   * the shape carried by each code.
   *
   * @example
   * ```ts
   * const dispose = host.on('CDK_TOOLKIT_I2901', async (msg) => {
   *   myCount += (msg.data as StackDetailsPayload).stacks.length;
   *   await persist(myCount);
   * });
   * ```
   *
   * @example
   * ```ts
   * // A predicate matches a family of messages, e.g. every warning:
   * const dispose = host.on((msg) => msg.level === 'warn', (msg) => { ... });
   * ```
   */
  on<T>(
    matcher: IMessageMatcher<T>,
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): () => void;
  on(
    selector: IoMessageCode | MessagePredicate,
    listener: (msg: IoMessage<unknown>) => MessageListenerResultOrPromise,
  ): () => void;

  /**
   * Like `on`, but the listener is automatically removed after it has been
   * invoked once.
   */
  once<T>(
    matcher: IMessageMatcher<T>,
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): () => void;
  once(
    selector: IoMessageCode | MessagePredicate,
    listener: (msg: IoMessage<unknown>) => MessageListenerResultOrPromise,
  ): () => void;

  /**
   * Register a formatter that replaces the printed text of matching messages —
   * selected by a message `code`, a `MessagePredicate`, or a matcher. This lets
   * a caller define _how_ a toolkit message is presented without the host
   * needing to know about it.
   *
   * Optionally pass a `level` to also override the message's level. Syntactic
   * sugar for an `on` listener that returns the new `message` and `level`.
   * Returns a function that removes the formatter again.
   *
   * @example
   * ```ts
   * const dispose = host.rewrite('CDK_TOOLKIT_I2901', (msg) =>
   *   serializeStructure((msg.data as StackDetailsPayload).stacks, true));
   * ```
   */
  rewrite<T>(
    matcher: IMessageMatcher<T>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): () => void;
  rewrite(
    selector: IoMessageCode | MessagePredicate,
    formatter: (msg: IoMessage<unknown>) => string,
    level?: IoMessageLevel,
  ): () => void;

  /**
   * Like `rewrite`, but the formatter is automatically removed after it has
   * been applied once.
   */
  rewriteOnce<T>(
    matcher: IMessageMatcher<T>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): () => void;
  rewriteOnce(
    selector: IoMessageCode | MessagePredicate,
    formatter: (msg: IoMessage<unknown>) => string,
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
   * const dispose = host.respond('CDK_TOOLKIT_I7010', true);
   * ```
   */
  respond<T, U>(matcher: IRequestMatcher<T, U>, value: U, options?: RespondOptions): () => void;
  respond(code: IoMessageCode, value: unknown, options?: RespondOptions): () => void;

  /**
   * Like `respond`, but the answer is given only once and then removed.
   */
  respondOnce<T, U>(matcher: IRequestMatcher<T, U>, value: U, options?: RespondOptions): () => void;
  respondOnce(code: IoMessageCode, value: unknown, options?: RespondOptions): () => void;
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
 * host.on('CDK_TOOLKIT_I2901', (m) => { count += (m.data as StackDetailsPayload).stacks.length; });
 * const toolkit = new Toolkit({ ioHost: host });
 * ```
 */
export function withListeners<T extends IIoHost>(host: T): T & IoHostWithListeners {
  return new ListeningIoHost(host) as unknown as T & IoHostWithListeners;
}

/**
 * An `IIoHost` that runs a `ListenerRegistry` around a wrapped host.
 *
 * The registry is the shared listener engine (also used by the CLI's terminal
 * host); this class adds the wrapped-host plumbing that turns it into an
 * `IIoHost`, and adapts the public code-keyed API onto the registry's matchers.
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

  public on(
    selector: IMessageMatcher<any> | IoMessageCode | MessagePredicate,
    listener: (msg: IoMessage<any>) => MessageListenerResultOrPromise,
  ): () => void {
    return this.registry.on(toMatcher(selector), listener);
  }

  public once(
    selector: IMessageMatcher<any> | IoMessageCode | MessagePredicate,
    listener: (msg: IoMessage<any>) => MessageListenerResultOrPromise,
  ): () => void {
    return this.registry.once(toMatcher(selector), listener);
  }

  public rewrite(
    selector: IMessageMatcher<any> | IoMessageCode | MessagePredicate,
    formatter: (msg: IoMessage<any>) => string,
    level?: IoMessageLevel,
  ): () => void {
    return this.registry.on(toMatcher(selector), (msg) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) }));
  }

  public rewriteOnce(
    selector: IMessageMatcher<any> | IoMessageCode | MessagePredicate,
    formatter: (msg: IoMessage<any>) => string,
    level?: IoMessageLevel,
  ): () => void {
    return this.registry.once(toMatcher(selector), (msg) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) }));
  }

  public respond(selector: IRequestMatcher<any, any> | IoMessageCode, value: unknown, options: RespondOptions = {}): () => void {
    const suppressQuestion = options.suppressQuestion ?? true;
    // Only answer requests; on a notification code there's nothing to answer, so
    // leave it untouched rather than suppress it (which would drop the message).
    return this.registry.on(toMatcher(selector), (msg) =>
      'defaultResponse' in msg ? { respond: value, preventDefault: suppressQuestion } : undefined);
  }

  public respondOnce(selector: IRequestMatcher<any, any> | IoMessageCode, value: unknown, options: RespondOptions = {}): () => void {
    const suppressQuestion = options.suppressQuestion ?? true;
    return this.registry.once(toMatcher(selector), (msg) =>
      'defaultResponse' in msg ? { respond: value, preventDefault: suppressQuestion } : undefined);
  }
}

/**
 * Resolve a code-or-predicate selector into the predicate the registry matches
 * on: a code becomes a code-equality check, a predicate is used as-is.
 */
function toMatcher(selector: IMessageMatcher<any> | IoMessageCode | MessagePredicate): MessagePredicate {
  if (typeof selector === 'string') {
    return byCode(selector);
  }
  if (typeof selector === 'function') {
    return selector;
  }
  return (msg) => selector.is(msg);
}

/**
 * Build a matcher that fires for messages carrying the given code.
 */
function byCode(code: IoMessageCode): MessagePredicate {
  return (msg) => msg.code === code;
}
