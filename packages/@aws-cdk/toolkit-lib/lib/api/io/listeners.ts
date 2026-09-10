import type { IIoHost } from './io-host';
import type { IoMessage, IoRequest, IoMessageCode, IoMessageLevel } from './io-message';
import { ListenerRegistry } from './private/listener-registry';
import type { ToolkitAction } from './toolkit-action';

/**
 * Decides whether a listener applies to a message.
 *
 * This is the only selector concept: every way of picking messages is a
 * predicate over the public `IoMessage` shape. Write any `(msg) => boolean`,
 * such as `(msg) => msg.level === 'warn'` to select a whole level, or use
 * `byCode` to select by message code.
 *
 * A matcher may also be a type guard (`(msg) => msg is IoMessage<T>`), in which
 * case the listener receives a typed payload. `byCode` produces one.
 */
export type MessageMatcher = (msg: IoMessage<unknown>) => boolean;

/**
 * Build a matcher that fires for messages carrying any of the given codes.
 *
 * The codes and the payload each one carries are listed in the message registry:
 * https://docs.aws.amazon.com/cdk/api/toolkit-lib/message-registry/
 *
 * The result is a type guard, so passing the payload type narrows `msg.data` in
 * the listener. To answer a request you narrow to the request instead, which is
 * what makes the response value type-checked.
 *
 * @example
 * ```ts
 * // Untyped payload.
 * host.on(byCode('CDK_TOOLKIT_I2901'), (msg) => { ... });
 *
 * // Typed payload.
 * host.on(byCode<StackDetailsPayload>('CDK_TOOLKIT_I2901'), (msg) => msg.data.stacks);
 *
 * // Typed request, so the response value is checked.
 * host.respond(byCode<IoRequest<void, boolean>>('CDK_TOOLKIT_I7010'), true);
 * ```
 */
export function byCode<T = unknown>(
  ...codes: IoMessageCode[]
): (msg: IoMessage<unknown>) => msg is (T extends IoMessage<unknown> ? T : IoMessage<T>) {
  return (msg): msg is (T extends IoMessage<unknown> ? T : IoMessage<T>) =>
    msg.code !== undefined && codes.includes(msg.code);
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
   * Whether to still surface the question text while answering it.
   *
   * @default false - answer silently
   */
  readonly showQuestion?: boolean;
}

/**
 * Options for `rewrite`/`rewriteOnce`.
 */
export interface RewriteOptions {
  /**
   * Override the level of the rewritten message as well as its text.
   *
   * @default - the message level is left unchanged
   */
  readonly level?: IoMessageLevel;
}

/**
 * Attaches listeners to the stream of messages and requests flowing through an
 * `IIoHost`.
 *
 * The result of `withListeners`. Listeners observe individual messages, reshape
 * how they are presented, or answer requests, without subclassing a host.
 * Messages are selected with a `MessageMatcher`; every registration returns a
 * `DisposeListener` that removes the listener again.
 *
 * Dispatch contract, shared by every method here:
 *
 * - Listeners run in registration order, and each one is awaited before the next
 *   one starts, so the cumulative effect on a message is deterministic.
 * - Matching is decided against the message as emitted, so a rewrite by an
 *   earlier listener never changes which later listeners apply.
 * - A listener that throws aborts the whole dispatch and the error propagates to
 *   the caller that emitted the message. The message is not written.
 * - The set of listeners is snapshotted when a message arrives, so registering or
 *   disposing during a dispatch only takes effect from the next message. A newly
 *   registered listener does not see the message in flight, and a disposed one
 *   still runs for it.
 * - If two listeners both answer a request, the last one wins.
 */
export interface IoEmitter {
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
   * `byCode` and the message makers are type guards. Otherwise the payload is
   * delivered as `unknown`; see the message registry for the shape carried by
   * each code.
   *
   * @example
   * ```ts
   * const dispose = host.on(byCode<StackDetailsPayload>('CDK_TOOLKIT_I2901'), async (msg) => {
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
   * Syntactic sugar for an `on` listener that returns the new `message`, and the
   * new `level` if one is given.
   *
   * @example
   * ```ts
   * const dispose = host.rewrite(byCode<StackDetailsPayload>('CDK_TOOLKIT_I2901'), (msg) =>
   *   `${msg.data.stacks.length} stacks`);
   * ```
   */
  rewrite<T>(
    matcher: (msg: IoMessage<unknown>) => msg is IoMessage<T>,
    formatter: (msg: IoMessage<T>) => string,
    options?: RewriteOptions,
  ): DisposeListener;
  rewrite<T = unknown>(
    matcher: MessageMatcher,
    formatter: (msg: IoMessage<T>) => string,
    options?: RewriteOptions,
  ): DisposeListener;

  /**
   * Like `rewrite`, but the formatter is automatically removed after it has
   * been applied once.
   */
  rewriteOnce<T>(
    matcher: (msg: IoMessage<unknown>) => msg is IoMessage<T>,
    formatter: (msg: IoMessage<T>) => string,
    options?: RewriteOptions,
  ): DisposeListener;
  rewriteOnce<T = unknown>(
    matcher: MessageMatcher,
    formatter: (msg: IoMessage<T>) => string,
    options?: RewriteOptions,
  ): DisposeListener;

  /**
   * Answer matching requests on the caller's behalf with a fixed value, so the
   * wrapped host is not asked to prompt. Syntactic sugar for an `on` listener
   * that responds with the value and prevents the default; for conditional
   * answers or to also reword the question, use `on`/`once` directly.
   *
   * The matcher must narrow to `IoRequest`, which is what makes `value` checked
   * against the request's response type. The message makers do this, and so does
   * `byCode` when you give it the request type. A plain predicate carries no
   * response type, so it cannot be used here; use `on` with
   * `{ respond: value, preventDefault: true }` if you need to select requests
   * some other way.
   *
   * By default the question is answered silently. Pass `{ showQuestion: true }`
   * to surface the question anyway, which is useful when the answer comes from a
   * flag the user passed and you still want the prompt in the log.
   *
   * @example
   * ```ts
   * const dispose = host.respond(byCode<IoRequest<void, boolean>>('CDK_TOOLKIT_I7010'), true);
   * ```
   */
  respond<T, U>(
    matcher: (msg: IoMessage<unknown>) => msg is IoRequest<T, U>,
    value: U,
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
}

/**
 * An `IIoHost` that listeners can be attached to, as returned by
 * `withListeners`. The original host type is preserved, so all of its own
 * methods and properties remain available and correctly typed.
 */
export type EmittingIoHost<T extends IIoHost = IIoHost> = T & IoEmitter;

/**
 * Hosts that have already been wrapped, keyed on the host they wrap.
 *
 * Keyed on the host itself (rather than marked on the wrapper) so that wrapping
 * the *same* host twice returns the same wrapper, instead of quietly building a
 * second registry whose listeners never fire. Each wrapper is also registered
 * under itself, so re-wrapping a wrapper is a no-op too.
 */
const WRAPPED = new WeakMap<IIoHost, EmittingIoHost<any>>();

/**
 * Wrap any `IIoHost` so listeners can be attached to it.
 *
 * The returned host is the host you pass in. Every property and method of it
 * keeps working, and its type is preserved, extended with the `IoEmitter`
 * methods, and with `notify` and `requestResponse` running matching listeners
 * before forwarding. On `notify` it runs the listeners, applies any rewrite,
 * and skips the wrapped host's write if a listener prevented the default. On
 * `requestResponse` a listener can reword the prompt text or answer it with
 * `respond`, in which case the request resolves without asking the wrapped
 * host to prompt.
 *
 * Wrapping is idempotent: passing a host that is already wrapped, or a wrapper
 * itself, returns the existing wrapper. Its lifecycle stays yours: you wrap a
 * host, register listeners, and pass it to the toolkit, all explicit.
 *
 * @example
 * ```ts
 * const host = withListeners(new NonInteractiveIoHost()); // or your own host
 * host.on(byCode<StackDetailsPayload>('CDK_TOOLKIT_I2901'), (m) => { count += m.data.stacks.length; });
 * const toolkit = new Toolkit({ ioHost: host });
 * ```
 */
export function withListeners<T extends IIoHost>(host: T): EmittingIoHost<T> {
  const existing = WRAPPED.get(host);
  if (existing) {
    return existing;
  }

  const registry = new ListenerRegistry();

  // Everything the proxy adds to (or intercepts on) the wrapped host: the
  // listener registrations, and the `notify`/`requestResponse` that run the
  // registry around the host's own handling.
  const additions: IoEmitter & IIoHost = {
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
    rewrite: (matcher: MessageMatcher, formatter: (msg: IoMessage<any>) => string, options?: RewriteOptions) =>
      registry.rewrite(matcher, formatter, options),
    rewriteOnce: (matcher: MessageMatcher, formatter: (msg: IoMessage<any>) => string, options?: RewriteOptions) =>
      registry.rewriteOnce(matcher, formatter, options),
    respond: (matcher: MessageMatcher, value: unknown, options?: RespondOptions) =>
      registry.respond(matcher, value, options),
    respondOnce: (matcher: MessageMatcher, value: unknown, options?: RespondOptions) =>
      registry.respondOnce(matcher, value, options),
  };

  // Forwarded methods are bound to the host, not to the proxy, so that `this`
  // inside them is the real instance. That is load-bearing rather than cosmetic:
  // a host that uses `#private` fields throws a `TypeError` if its methods run
  // with the proxy as `this`. The bound copies are memoized so method identity
  // is stable (`p.foo === p.foo`); a write through the proxy invalidates the
  // memo for that property.
  const boundCache = new Map<string | symbol, unknown>();

  const proxy = new Proxy(host, {
    get(target, prop) {
      // `Object.hasOwn`, not `prop in additions`: `in` walks
      // `Object.prototype`, which would shadow the host's `constructor`,
      // `toString`, `valueOf` and friends with the literal's inherited ones.
      if (Object.hasOwn(additions, prop)) {
        return (additions as any)[prop];
      }
      const value = Reflect.get(target, prop, target);
      // `constructor` is excluded from binding: it is compared by identity
      // (`host.constructor === MyHost`), and binding would hand back a
      // different function object named `bound MyHost`.
      if (typeof value !== 'function' || prop === 'constructor') {
        return value;
      }
      let bound = boundCache.get(prop);
      if (bound === undefined) {
        bound = value.bind(target);
        boundCache.set(prop, bound);
      }
      return bound;
    },
    set(target, prop, value) {
      boundCache.delete(prop);
      return Reflect.set(target, prop, value);
    },
    has(target, prop) {
      return Object.hasOwn(additions, prop) || Reflect.has(target, prop);
    },
    ownKeys(target) {
      return [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(additions)])];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (Object.hasOwn(additions, prop)) {
        // Non-enumerable, so the additions behave like the methods on a class's
        // prototype: `'on' in host` is true and `Object.keys(host)` and
        // `{ ...host }` are unchanged from the unwrapped host.
        return { value: (additions as any)[prop], writable: false, enumerable: false, configurable: true };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  }) as EmittingIoHost<T>;

  WRAPPED.set(host, proxy);
  WRAPPED.set(proxy, proxy);

  return proxy;
}
