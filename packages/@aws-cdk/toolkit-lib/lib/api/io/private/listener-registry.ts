// `DisposeListener` uses `Symbol.dispose`, which must exist in the
// environment. This file can be imported without going through the package
// entrypoint (which normally loads the polyfill), so load it here too.
import '../../../private/dispose-polyfill';
import type { IoMessage, IoMessageLevel } from '../io-message';
import type { DisposeListener, MessageMatcher, MessageListenerResultOrPromise, RespondOptions } from '../listeners';

/**
 * Make a plain remover function usable as a `Disposable` (see `DisposeListener`).
 */
function disposeListener(dispose: () => void): DisposeListener {
  return Object.assign(dispose, { [Symbol.dispose]: dispose });
}

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
   * Decides which messages this listener applies to.
   */
  readonly matches: MessageMatcher;
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
 * A registry of message listeners, run in registration order.
 *
 * This is the shared listener engine: both the CLI's terminal host and the
 * public `withListeners` wrapper own one and run their messages through it, so
 * there is a single implementation of matching, ordering, rewriting, and
 * request answering. A host composes a registry and does its own I/O (writing,
 * prompting, telemetry) around `apply`.
 */
export class ListenerRegistry {
  // Listeners in registration order. See `on`/`once`/`rewrite`/`respond`.
  private readonly listeners: MessageListener[] = [];

  /**
   * Register a listener that is invoked for every message the matcher accepts.
   * Returns a remover for it (callable and `using`-compatible).
   */
  public on(matches: MessageMatcher, listener: MessageListenerFn): DisposeListener {
    return this.add({ once: false, fn: listener, matches });
  }

  /**
   * Like `on`, but the listener is automatically removed after it has been
   * invoked once.
   */
  public once(matches: MessageMatcher, listener: MessageListenerFn): DisposeListener {
    return this.add({ once: true, fn: listener, matches });
  }

  /**
   * Register a formatter that replaces the printed text of matching messages,
   * optionally also overriding the level. Syntactic sugar for an `on` listener
   * that returns `{ message, level? }`.
   */
  public rewrite(matches: MessageMatcher, formatter: (msg: IoMessage<any>) => string, level?: IoMessageLevel): DisposeListener {
    return this.add({ once: false, fn: rewriteFn(formatter, level), matches });
  }

  /**
   * Like `rewrite`, but the formatter is removed after it has been applied once.
   */
  public rewriteOnce(matches: MessageMatcher, formatter: (msg: IoMessage<any>) => string, level?: IoMessageLevel): DisposeListener {
    return this.add({ once: true, fn: rewriteFn(formatter, level), matches });
  }

  /**
   * Answer a matching request with a fixed value so the host does not prompt.
   * Syntactic sugar for an `on` listener returning
   * `{ respond: value, preventDefault: options.suppressQuestion }`.
   */
  public respond(matches: MessageMatcher, value: unknown, options: RespondOptions = {}): DisposeListener {
    return this.add({ once: false, fn: respondFn(value, options), matches });
  }

  /**
   * Like `respond`, but the answer is given only once and then removed.
   */
  public respondOnce(matches: MessageMatcher, value: unknown, options: RespondOptions = {}): DisposeListener {
    return this.add({ once: true, fn: respondFn(value, options), matches });
  }

  /**
   * Run every registered listener that matches the message, in registration
   * order.
   *
   * A listener may update the message text, level, and/or action (passed on to
   * subsequent listeners and the host), prevent the default handling, or (for
   * requests) answer it. `once` listeners are removed after they have run.
   * Matching is decided against the message as emitted, so a rewrite by an
   * earlier listener does not change which later listeners apply.
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

      // Claim a `once` listener before the await; a concurrent `apply` that
      // already removed it (index < 0) skips it, so it fires exactly once.
      if (listener.once) {
        const index = this.listeners.indexOf(listener);
        if (index < 0) {
          continue;
        }
        this.listeners.splice(index, 1);
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
        if (result.action !== undefined) {
          current = { ...current, action: result.action };
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
   * Add a listener to the registry and return a remover for it (callable and
   * `using`-compatible, see `DisposeListener`).
   */
  private add(listener: MessageListener): DisposeListener {
    this.listeners.push(listener);

    return disposeListener(() => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    });
  }
}

/**
 * The listener behind `rewrite`/`rewriteOnce`.
 */
function rewriteFn(formatter: (msg: IoMessage<any>) => string, level?: IoMessageLevel): MessageListenerFn {
  return (msg) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) });
}

/**
 * The listener behind `respond`/`respondOnce`. Only answers requests; a plain
 * notification that happens to match is left untouched.
 */
function respondFn(value: unknown, options: RespondOptions): MessageListenerFn {
  const suppressQuestion = options.suppressQuestion ?? true;
  return (msg) => ('defaultResponse' in msg ? { respond: value, preventDefault: suppressQuestion } : undefined);
}
