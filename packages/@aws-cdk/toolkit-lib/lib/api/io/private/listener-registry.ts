import type { IoMessage, IoMessageLevel, IMessageMatcher } from '../io-message';

/**
 * The result a message listener may return to influence how a message is handled.
 *
 * A listener may update the message _text_ and/or its _level_; it cannot change
 * any other field of the message (such as its `code`), which keeps the
 * code-keyed listener registry valid.
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
 * Listeners may be async. The registry awaits each listener before running the
 * next, so registration order — and the cumulative effect on the message — is
 * preserved regardless of whether listeners are sync or async.
 */
export type MessageListenerResultOrPromise = void | MessageListenerResult | Promise<void | MessageListenerResult>;

/**
 * Selects which messages a listener applies to.
 *
 * Either an `IMessageMatcher` — the makers implement this, so a maker fires for
 * its own messages — or a custom *predicate* over the message (e.g. to match a
 * family of codes, or on the message level). Use `matchAny` to combine several.
 */
export type MessageSelector<T> =
  | IMessageMatcher<T>
  | ((msg: IoMessage<any>) => boolean);

/**
 * A function a listener runs when a matching message appears.
 */
export type MessageListenerFn = (msg: IoMessage<any>) => MessageListenerResultOrPromise;

/**
 * A registered message listener.
 */
interface MessageListener {
  readonly once: boolean;
  readonly fn: MessageListenerFn;
  /**
   * Decides which messages this listener applies to. For a listener registered
   * with a maker this matches by `code`; for one registered with a predicate it
   * is the predicate itself.
   */
  readonly matches: (msg: IoMessage<unknown>) => boolean;
  /**
   * Whether this is one of a host's own internal listeners (e.g. stack-activity
   * routing). Internal listeners are not removed by `removeUserListeners`.
   *
   * @default false - a user listener registered via `on`/`once`/`rewrite`/`respond`
   */
  readonly internal?: boolean;
}

/**
 * The outcome of running the registry's listeners over a single message.
 */
export interface AppliedListeners<T> {
  /**
   * The (possibly rewritten) message to hand to the host's default handling.
   */
  readonly message: T;

  /**
   * Whether a listener asked to skip the default handling.
   */
  readonly preventDefault: boolean;

  /**
   * Whether a listener answered a request (its answer is folded into
   * `message.defaultResponse`).
   */
  readonly responded: boolean;
}

/**
 * A registry of message listeners, keyed by code or predicate, run in
 * registration order.
 *
 * This is the shared listener engine: both the CLI's terminal host and the
 * public `withListeners` wrapper own one and run their messages through it, so
 * there is a single implementation of matching, ordering, rewriting, and
 * request answering. A host composes a registry and does its own I/O (writing,
 * prompting, telemetry) around `apply`.
 */
export class ListenerRegistry {
  // Listeners in registration order. Each carries a matcher (by code, or a
  // custom predicate). See `on`/`once`/`rewrite`/`respond`.
  private readonly listeners: MessageListener[] = [];

  /**
   * Register a listener that is invoked for every message that matches the
   * selector. Returns a function that removes the listener again.
   */
  public on<T>(
    selector: IMessageMatcher<T> | ((msg: IoMessage<any>) => msg is IoMessage<T>),
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): () => void;
  public on(
    predicate: (msg: IoMessage<any>) => boolean,
    listener: (msg: IoMessage<unknown>) => MessageListenerResultOrPromise,
  ): () => void;
  public on(selector: MessageSelector<any>, listener: MessageListenerFn): () => void {
    return this.add({ once: false, fn: listener, matches: messageMatcher(selector) });
  }

  /**
   * Like `on`, but the listener is automatically removed after it has been
   * invoked once.
   */
  public once<T>(
    selector: IMessageMatcher<T> | ((msg: IoMessage<any>) => msg is IoMessage<T>),
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): () => void;
  public once(
    predicate: (msg: IoMessage<any>) => boolean,
    listener: (msg: IoMessage<unknown>) => MessageListenerResultOrPromise,
  ): () => void;
  public once(selector: MessageSelector<any>, listener: MessageListenerFn): () => void {
    return this.add({ once: true, fn: listener, matches: messageMatcher(selector) });
  }

  /**
   * Register a formatter that replaces the printed text of matching messages,
   * optionally also overriding the level. Syntactic sugar for an `on` listener
   * that returns `{ message, level? }`.
   */
  public rewrite(
    selector: MessageSelector<any>,
    formatter: (msg: IoMessage<any>) => string,
    level?: IoMessageLevel,
  ): () => void {
    const fn = (msg: IoMessage<any>) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) });
    return this.add({ once: false, fn, matches: messageMatcher(selector) });
  }

  /**
   * Like `rewrite`, but the formatter is removed after it has been applied once.
   */
  public rewriteOnce(
    selector: MessageSelector<any>,
    formatter: (msg: IoMessage<any>) => string,
    level?: IoMessageLevel,
  ): () => void {
    const fn = (msg: IoMessage<any>) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) });
    return this.add({ once: true, fn, matches: messageMatcher(selector) });
  }

  /**
   * Answer a request (by its code) with a fixed value so the host does not
   * prompt. Syntactic sugar for an `on` listener returning
   * `{ respond: value, preventDefault: suppressQuestion }`.
   *
   * @param suppressQuestion - whether to also suppress surfacing the question
   *   text. Defaults to `true` (answer silently).
   */
  public respond(selector: MessageSelector<any>, value: unknown, suppressQuestion = true): () => void {
    const fn = (msg: IoMessage<unknown>) => ('defaultResponse' in msg ? { respond: value, preventDefault: suppressQuestion } : undefined);
    return this.add({ once: false, fn, matches: messageMatcher(selector) });
  }

  /**
   * Like `respond`, but the answer is given only once and then removed.
   */
  public respondOnce(selector: MessageSelector<any>, value: unknown, suppressQuestion = true): () => void {
    const fn = (msg: IoMessage<unknown>) => ('defaultResponse' in msg ? { respond: value, preventDefault: suppressQuestion } : undefined);
    return this.add({ once: true, fn, matches: messageMatcher(selector) });
  }

  /**
   * Register one of the host's own internal listeners (e.g. stack-activity
   * routing). Unlike listeners added via `on`/`once`/etc., an internal listener
   * survives `removeUserListeners`. Returns a function that removes it.
   */
  public addInternal(matches: (msg: IoMessage<unknown>) => boolean, fn: MessageListenerFn): () => void {
    return this.add({ once: false, internal: true, fn, matches });
  }

  /**
   * Remove every listener registered via `on`/`once`/`rewrite`/`respond`,
   * keeping the host's internal listeners so the host keeps working afterwards.
   */
  public removeUserListeners(): void {
    // Drop user listeners in place (preserving array identity for any
    // outstanding dispose closures); keep the host's internal listeners.
    for (let i = this.listeners.length - 1; i >= 0; i--) {
      if (!this.listeners[i].internal) {
        this.listeners.splice(i, 1);
      }
    }
  }

  /**
   * Run every registered listener that matches the message, in registration
   * order. A listener matches by its code (maker) or its custom predicate.
   *
   * A listener may update the message text/level (passed on to subsequent
   * listeners and the host), prevent the default handling, or (for requests)
   * answer it. `once` listeners are removed after they have run. Matching is
   * decided against the message as emitted, so a rewrite by an earlier listener
   * does not change which later listeners apply.
   *
   * Returns the (possibly updated) message, whether the default handling was
   * prevented, and whether a listener answered the request (folded into the
   * message's `defaultResponse`).
   */
  public async apply<T extends IoMessage<unknown>>(msg: T): Promise<AppliedListeners<T>> {
    let current = msg;
    let preventDefault = false;
    let responded = false;
    // Iterate over a copy so that `once` listeners can remove themselves safely.
    for (const listener of [...this.listeners]) {
      // Match against the emitted message; a listener receives the cumulatively
      // transformed `current` message.
      if (!listener.matches(msg)) {
        continue;
      }

      // Remove a `once` listener before the await, so a concurrent `apply`
      // (e.g. parallel stacks on one host) can't fire it a second time.
      if (listener.once) {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      }

      // Listeners may be async; await each one before running the next so the
      // cumulative effect on the message stays order-deterministic.
      const result = await listener.fn(current);

      if (result) {
        if (result.message !== undefined) {
          current = { ...current, message: result.message };
        }
        if (result.level !== undefined) {
          current = { ...current, level: result.level };
        }
        if (result.preventDefault) {
          preventDefault = true;
        }
        // The presence of the key is what matters (so `false`/`0`/`''` are valid
        // answers); `'defaultResponse' in msg` tells a request from a notification.
        if ('respond' in result && 'defaultResponse' in msg) {
          current = { ...current, defaultResponse: result.respond };
          responded = true;
        }
      }
    }

    return { message: current, preventDefault, responded };
  }

  /**
   * Add a listener to the registry and return a function that removes it.
   */
  private add(listener: MessageListener): () => void {
    this.listeners.push(listener);

    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }
}

/**
 * Convert a `MessageSelector` into a predicate that decides whether a listener
 * applies to a message. A matcher uses its `is` type guard; a predicate (any
 * `(msg) => boolean`) is used as-is.
 */
export function messageMatcher(selector: MessageSelector<any>): (msg: IoMessage<unknown>) => boolean {
  if (typeof selector === 'function') {
    return selector;
  }
  return (msg) => selector.is(msg);
}

/**
 * Combine several selectors into a single predicate that matches a message when
 * *any* of them matches. Each selector may be a maker (matched by its `code`)
 * or a predicate.
 *
 * @example
 * ```ts
 * host.on(matchAny(IO.CDK_TOOLKIT_I5501, IO.CDK_TOOLKIT_I5502), listener);
 * ```
 */
export function matchAny(...selectors: MessageSelector<any>[]): (msg: IoMessage<unknown>) => boolean {
  const matchers = selectors.map(messageMatcher);
  return (msg) => matchers.some((matches) => matches(msg));
}
