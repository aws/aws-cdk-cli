// The `DisposeListener` interface uses `Symbol.dispose`, which must exist in
// the environment. This file can be imported without going through the
// package entrypoint (which normally loads the polyfill), so load it here too.
import '../../private/dispose-polyfill';
import type { IIoHost } from './io-host';
import type { IoMessage, IoRequest, IoMessageCode, IoMessageLevel } from './io-message';
import { ListenerRegistry } from './private/listener-registry';
import type { ToolkitAction } from './toolkit-action';

/**
 * Decides whether a listener applies to a message.
 *
 * This is the only selector concept: every way of picking messages is a
 * predicate over the public `IoMessage` shape. Use `byCode` to match one or
 * more message codes, `matchAny` to combine matchers, or write any
 * `(msg) => boolean`, such as `(msg) => msg.level === 'warn'` for a whole level.
 *
 * A matcher may also be a type guard (`(msg) => msg is IoMessage<T>`), in which
 * case the listener receives a typed payload.
 */
export type MessageMatcher = (msg: IoMessage<unknown>) => boolean;

/**
 * Build a matcher that fires for messages carrying any of the given codes.
 *
 * The codes are listed in the message registry:
 * https://docs.aws.amazon.com/cdk/api/toolkit-lib/message-registry/
 *
 * @example
 * ```ts
 * host.on(byCode('CDK_TOOLKIT_I2901'), listener);
 * ```
 */
export function byCode(...codes: IoMessageCode[]): MessageMatcher {
  return (msg) => msg.code !== undefined && codes.includes(msg.code);
}

/**
 * Combine several matchers into a single matcher that fires when *any* of them
 * matches.
 *
 * @example
 * ```ts
 * host.on(matchAny(IO.CDK_TOOLKIT_I5501.is, IO.CDK_TOOLKIT_I5502.is), listener);
 * ```
 */
export function matchAny(...matchers: MessageMatcher[]): MessageMatcher {
  return (msg) => matchers.some((matches) => matches(msg));
}

/**
 * The result a message listener may return to influence how a message is handled.
 *
 * A listener may update the message _text_, _level_, and/or _action_; it cannot
 * change other fields (such as its `code`), which keeps listener matching valid.
 */
export interface MessageListenerResult {
  /**
   * Replace the text that is printed for this message.
   *
   * @default - the message text is left unchanged
   */
  readonly message?: string;

  /**
   * Override the level of this message.
   *
   * A host may use the level for verbosity filtering and for deciding where to
   * route the message, so overriding it can change whether and where the message
   * is shown. The `code` is intentionally left unchanged.
   *
   * @default - the message level is left unchanged
   */
  readonly level?: IoMessageLevel;

  /**
   * Override the action associated with this message.
   *
   * The override affects subsequent listeners and the handling of the effective
   * message. Matching continues to use the action on the originally emitted
   * message.
   *
   * @default - the message action is left unchanged
   */
  readonly action?: ToolkitAction;

  /**
   * Skip the default handling of the message.
   *
   * For a notification this means the host is not asked to handle it. For a
   * request it stops processing entirely: the host is not asked to prompt, and
   * the request resolves with its (possibly `respond`-overridden) default
   * response.
   *
   * @default false
   */
  readonly preventDefault?: boolean;

  /**
   * For requests only: the value to resolve the request with. It is folded into
   * the request's default response and skips the prompt (the host is not asked
   * to answer). The question is still surfaced unless `preventDefault` is also
   * set. Ignored for plain notifications.
   *
   * The presence of the key is what matters, so `false`/`0`/`''` are valid
   * answers. Use the `respond`/`respondOnce` helpers for the common case.
   *
   * @default - this listener does not supply a response
   */
  readonly respond?: unknown;
}

/**
 * What a message listener may return: nothing, a `MessageListenerResult`, or a
 * `Promise` of either.
 *
 * Listeners may be async. Each listener is awaited before the next one runs, so
 * registration order is preserved, and so is the cumulative effect on the
 * message, regardless of whether listeners are sync or async.
 */
export type MessageListenerResultOrPromise = void | MessageListenerResult | Promise<void | MessageListenerResult>;

/**
 * Removes a previously registered message listener.
 *
 * Callable directly (`dispose()`), and also a `Disposable`, so it can be bound
 * to the enclosing scope with a `using` declaration. The listener is then
 * removed when the scope exits, even on an early return or a throw:
 *
 * ```ts
 * using _fmt = host.rewrite(byCode('CDK_TOOLKIT_I2901'), format);
 * ```
 *
 * `using x = cond ? host.on(...) : undefined` is also valid: disposal is
 * simply skipped for `undefined`, which makes conditional listeners cheap.
 */
export interface DisposeListener {
  (): void;
  [Symbol.dispose](): void;
}

/**
 * Options for `respond`/`respondOnce`.
 */
export interface RespondOptions {
  /**
   * Whether to also suppress surfacing the question text.
   *
   * @default true - answer silently
   */
  readonly suppressQuestion?: boolean;
}

/**
 * Attaches listeners to the stream of messages and requests flowing through an
 * `IIoHost`.
 *
 * The result of `withListeners`. Listeners observe individual messages,
 * reshape how they are presented, or answer requests, without subclassing a
 * host. Messages are selected with a `MessageMatcher`; every registration
 * returns a `DisposeListener` that removes the listener again.
 */
export interface IIoEmitter {
  /**
   * Register a listener that is invoked for every message the matcher accepts.
   *
   * The listener may return a `MessageListenerResult` to update the message
   * text, level, and/or action or prevent the default handling (asking the
   * wrapped host to write it); returning nothing leaves the message untouched.
   * The listener may be async (return a `Promise`); it is awaited before the
   * message is handled further.
   *
   * When the matcher is a type guard, the listener receives a typed payload.
   * Otherwise the payload is delivered as `unknown`; see the message registry
   * for the shape carried by each code, and pass the payload type explicitly
   * if you want it typed.
   *
   * @example
   * ```ts
   * const dispose = host.on<StackDetailsPayload>(byCode('CDK_TOOLKIT_I2901'), async (msg) => {
   *   myCount += msg.data.stacks.length;
   *   await persist(myCount);
   * });
   * ```
   *
   * @example
   * ```ts
   * // Any predicate over the message works, e.g. every warning:
   * const dispose = host.on((msg) => msg.level === 'warn', (msg) => {
   *   warnings.push(msg.message);
   * });
   * ```
   */
  on<T>(
    matcher: (msg: IoMessage<unknown>) => msg is IoMessage<T>,
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): DisposeListener;
  on<T = unknown>(
    matcher: MessageMatcher,
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): DisposeListener;

  /**
   * Like `on`, but the listener is automatically removed after it has been
   * invoked once.
   */
  once<T>(
    matcher: (msg: IoMessage<unknown>) => msg is IoMessage<T>,
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): DisposeListener;
  once<T = unknown>(
    matcher: MessageMatcher,
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): DisposeListener;

  /**
   * Register a formatter that replaces the printed text of matching messages.
   * This lets a caller define _how_ a message is presented without the host
   * needing to know about it.
   *
   * Optionally pass a `level` to also override the message's level. Syntactic
   * sugar for an `on` listener that returns the new `message` and `level`.
   *
   * @example
   * ```ts
   * const dispose = host.rewrite<StackDetailsPayload>(byCode('CDK_TOOLKIT_I2901'), (msg) =>
   *   `${msg.data.stacks.length} stacks`);
   * ```
   */
  rewrite<T>(
    matcher: (msg: IoMessage<unknown>) => msg is IoMessage<T>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): DisposeListener;
  rewrite<T = unknown>(
    matcher: MessageMatcher,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): DisposeListener;

  /**
   * Like `rewrite`, but the formatter is automatically removed after it has
   * been applied once.
   */
  rewriteOnce<T>(
    matcher: (msg: IoMessage<unknown>) => msg is IoMessage<T>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): DisposeListener;
  rewriteOnce<T = unknown>(
    matcher: MessageMatcher,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): DisposeListener;

  /**
   * Answer matching requests on the caller's behalf with a fixed value, so the
   * wrapped host is not asked to prompt. Syntactic sugar for an `on` listener
   * that responds with the value and prevents the default; for conditional
   * answers or to also reword the question, use `on`/`once` directly.
   *
   * By default the question is answered silently; pass
   * `{ suppressQuestion: false }` to still surface the question while
   * answering it. Plain notifications that happen to match are left untouched.
   *
   * When the matcher is a request type guard, the value is checked against the
   * request's response type.
   *
   * @example
   * ```ts
   * const dispose = host.respond(byCode('CDK_TOOLKIT_I7010'), true);
   * ```
   */
  respond<T, U>(
    matcher: (msg: IoMessage<unknown>) => msg is IoRequest<T, U>,
    value: U,
    options?: RespondOptions,
  ): DisposeListener;
  respond(
    matcher: MessageMatcher,
    value: unknown,
    options?: RespondOptions,
  ): DisposeListener;

  /**
   * Like `respond`, but the answer is given only once and then removed.
   */
  respondOnce<T, U>(
    matcher: (msg: IoMessage<unknown>) => msg is IoRequest<T, U>,
    value: U,
    options?: RespondOptions,
  ): DisposeListener;
  respondOnce(
    matcher: MessageMatcher,
    value: unknown,
    options?: RespondOptions,
  ): DisposeListener;
}

/**
 * Marks a host that already went through `withListeners`, making the wrapper
 * idempotent (wrapping twice returns the same proxy, so there is never a
 * second registry double-handling messages).
 */
const LISTENING = Symbol('withListeners');

/**
 * Wrap any `IIoHost` so listeners can be attached to it.
 *
 * The returned host is the host you pass in. Every property and method of it
 * keeps working, and its type is preserved, extended with the `IIoEmitter`
 * methods, and with `notify` and `requestResponse` running matching listeners
 * before forwarding. On `notify` it runs the listeners, applies any rewrite,
 * and skips the wrapped host's write if a listener prevented the default. On
 * `requestResponse` a listener can reword the prompt text or answer it with
 * `respond`, in which case the request resolves without asking the wrapped
 * host to prompt.
 *
 * Wrapping is idempotent: passing an already-wrapped host returns it
 * unchanged. Its lifecycle stays yours: you wrap a host, register listeners,
 * and pass it to the toolkit, all explicit.
 *
 * @example
 * ```ts
 * const host = withListeners(new NonInteractiveIoHost()); // or your own host
 * host.on<StackDetailsPayload>(byCode('CDK_TOOLKIT_I2901'), (m) => { count += m.data.stacks.length; });
 * const toolkit = new Toolkit({ ioHost: host });
 * ```
 */
export function withListeners<T extends IIoHost>(host: T): T & IIoEmitter {
  if ((host as any)[LISTENING]) {
    return host as T & IIoEmitter;
  }

  const registry = new ListenerRegistry();

  // Everything the proxy adds to (or intercepts on) the wrapped host: the
  // listener registrations, and the `notify`/`requestResponse` that run the
  // registry around the host's own handling.
  const additions: IIoEmitter & IIoHost & { [LISTENING]: true } = {
    [LISTENING]: true,

    async notify(msg: IoMessage<unknown>): Promise<void> {
      const { message, preventDefault } = await registry.apply(msg);
      if (preventDefault) {
        return;
      }
      return host.notify(message);
    },

    async requestResponse<D, R>(msg: IoRequest<D, R>): Promise<R> {
      const { message, preventDefault, responded } = await registry.apply(msg);

      // A listener suppressed the default handling: resolve with the (possibly
      // overridden) default response without asking the wrapped host.
      if (preventDefault) {
        return message.defaultResponse;
      }

      // A listener answered the request but wants the question surfaced: show it
      // via the wrapped host, then resolve with the answer instead of prompting.
      if (responded) {
        await host.notify(message);
        return message.defaultResponse;
      }

      // No listener answered: let the wrapped host resolve the (possibly
      // reworded) request as it sees fit (it may prompt, or use its own default).
      return host.requestResponse(message);
    },

    on: (matcher: MessageMatcher, listener: (msg: IoMessage<any>) => MessageListenerResultOrPromise) =>
      registry.on(matcher, listener),
    once: (matcher: MessageMatcher, listener: (msg: IoMessage<any>) => MessageListenerResultOrPromise) =>
      registry.once(matcher, listener),
    rewrite: (matcher: MessageMatcher, formatter: (msg: IoMessage<any>) => string, level?: IoMessageLevel) =>
      registry.rewrite(matcher, formatter, level),
    rewriteOnce: (matcher: MessageMatcher, formatter: (msg: IoMessage<any>) => string, level?: IoMessageLevel) =>
      registry.rewriteOnce(matcher, formatter, level),
    respond: (matcher: MessageMatcher, value: unknown, options?: RespondOptions) =>
      registry.respond(matcher, value, options),
    respondOnce: (matcher: MessageMatcher, value: unknown, options?: RespondOptions) =>
      registry.respondOnce(matcher, value, options),
  };

  return new Proxy(host, {
    get(target, prop) {
      if (prop in additions) {
        return (additions as any)[prop];
      }
      // Bind functions to the wrapped host so its methods and accessors keep
      // their `this` (the proxy is a view over the host, not a new identity).
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value);
    },
    has(target, prop) {
      return prop in additions || Reflect.has(target, prop);
    },
  }) as T & IIoEmitter;
}
