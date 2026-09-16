import { ToolkitError } from '../../../toolkit/toolkit-error';
import type { IIoHost } from '../io-host';
import type { IoMessage, IoRequest } from '../io-message';
import type { IoEmitter, MessageMatcher, MessageListenerResultOrPromise, RespondOptions, RewriteOptions } from '../listeners';
import { ListenerRegistry } from './listener-registry';

/**
 * How the listeners disposed of a single message or request.
 *
 * A wrapped host sees only the messages that reach it, and only in their final
 * form, so it cannot tell a rewritten message from an original one, and never
 * learns about a message the listeners dropped or a request they answered. This
 * reports all of that for one message, so a host can log, record, or meter the
 * complete stream it is at the bottom of.
 */
export interface ListenerVerdict {
  /**
   * Whether this describes a plain notification (`notify`) or a request that
   * asked for a response (`requestResponse`).
   */
  readonly type: 'notify' | 'request';

  /**
   * The message exactly as it was emitted, before any listener ran.
   */
  readonly emitted: IoMessage<unknown>;

  /**
   * The message after the listeners ran: its text, level, and/or action may
   * differ from `emitted`.
   *
   * For a request, `defaultResponse` is the value the request actually resolved
   * to, whether that came from a listener or from the wrapped host, so it is the
   * answer rather than the declared default.
   */
  readonly effective: IoMessage<unknown>;

  /**
   * Whether the wrapped host was skipped, i.e. a listener prevented the default
   * handling. For a notification that means the user never saw it; for a request
   * it means a listener answered it without the question being surfaced.
   */
  readonly dropped: boolean;
}

/**
 * Called once per message with how the listeners disposed of it, after the
 * wrapped host has handled it (or been skipped).
 */
export type ListenerVerdictHook = (verdict: ListenerVerdict) => void;

/**
 * Hosts that have already been wrapped, keyed on the host they wrap.
 *
 * Keyed on the host itself (rather than marked on the wrapper) so that wrapping
 * the *same* host twice returns the same wrapper, instead of quietly building a
 * second registry whose listeners never fire. Each wrapper is also registered
 * under itself, so re-wrapping a wrapper is a no-op too.
 */
const WRAPPED = new WeakMap<IIoHost, IIoHost & IoEmitter>();

/**
 * Wrap an `IIoHost` so listeners can be attached to it, optionally reporting
 * how the listeners disposed of each message.
 *
 * This is the implementation behind the public `withListeners`, which is this
 * function without the hook. The hook is private because it exists for a host
 * that sits at the *bottom* of the stack and needs to observe the whole stream
 * rather than react to individual messages — the CLI's terminal host, which
 * records it for snapshot tests. A public caller attaches a listener instead.
 *
 * @param host - the host to wrap
 * @param onVerdict - called once per message with how the listeners disposed of it
 * @throws ToolkitError if `onVerdict` is given for a host that is already
 * wrapped, since the existing wrapper is returned and the hook would silently
 * never fire.
 */
export function attachListeners<T extends IIoHost>(host: T, onVerdict?: ListenerVerdictHook): T & IoEmitter {
  const existing = WRAPPED.get(host);
  if (existing) {
    if (onVerdict) {
      throw new ToolkitError(
        'IoHostAlreadyWrapped',
        'cannot observe listener verdicts on a host that is already wrapped: the existing wrapper is returned and the hook would never fire',
      );
    }
    // `WRAPPED` is keyed by the host, so the wrapper stored under `host` is the
    // one built for it, and therefore still a `T`. The map cannot say so.
    return existing as T & IoEmitter;
  }

  const registry = new ListenerRegistry();

  // The host's own handling, captured now. Forwarding through `host.notify`
  // instead would re-enter anything later installed *on* the host, and such an
  // override is meant to wrap the listener layer rather than be wrapped by it —
  // `jest.spyOn(host, 'notify')` installs exactly that, and would otherwise
  // recurse until the heap gives out.
  const innerNotify = host.notify.bind(host);
  const innerRequestResponse = host.requestResponse.bind(host);

  // Everything the proxy adds to (or intercepts on) the wrapped host: the
  // listener registrations, and the `notify`/`requestResponse` that run the
  // registry around the host's own handling.
  const additions: IoEmitter & IIoHost = {
    async notify(msg: IoMessage<unknown>): Promise<void> {
      const { message, preventDefault } = await registry.apply(msg);
      if (!preventDefault) {
        await innerNotify(message);
      }
      onVerdict?.({ type: 'notify', emitted: msg, effective: message, dropped: preventDefault });
    },

    async requestResponse<D, R>(msg: IoRequest<D, R>): Promise<R> {
      const { message, preventDefault, responded } = await registry.apply(msg);

      // A listener answered the request, so the wrapped host is not asked to
      // prompt. Unless it also suppressed the question, surface it first, which
      // is what `respond({ showQuestion: true })` is for.
      if (responded) {
        if (!preventDefault) {
          await innerNotify(message);
        }
        onVerdict?.({ type: 'request', emitted: msg, effective: message, dropped: preventDefault });
        return message.defaultResponse;
      }

      // Suppressing the question without answering it would leave the request to
      // resolve with its declared default, which for a confirmation is `true`.
      // Silently approving on behalf of the user is never what the listener
      // meant, so this is a programming error rather than a default.
      if (preventDefault) {
        throw new ToolkitError(
          'ListenerPreventedRequestWithoutResponse',
          `a listener prevented the default handling of request ${message.code} without answering it; ` +
          'return `respond` alongside `preventDefault` (or use `respond`/`respondOnce`) to supply the answer',
        );
      }

      // No listener answered: let the wrapped host resolve the (possibly
      // reworded) request as it sees fit (it may prompt, or use its own default).
      const response = await innerRequestResponse(message);
      // Fold the answer the host produced back into `defaultResponse`, so that
      // `effective.defaultResponse` is the value the request resolved to on
      // every path, whether a listener or the host answered it.
      const answered: IoRequest<D, R> = { ...message, defaultResponse: response };
      onVerdict?.({ type: 'request', emitted: msg, effective: answered, dropped: false });
      return response;
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
      // The additions behave exactly like methods on a prototype: they are what
      // you get unless something is installed directly on the host, which then
      // shadows them the way an own property shadows an inherited one. That is
      // what makes `jest.spyOn(host, 'notify')` work on a wrapped host, and it
      // is why the additions are deliberately *not* reported as own properties
      // of the target (see `getOwnPropertyDescriptor`).
      //
      // `Object.hasOwn`, not `prop in additions`: `in` walks
      // `Object.prototype`, which would shadow the host's `constructor`,
      // `toString`, `valueOf` and friends with the literal's inherited ones.
      if (Object.hasOwn(additions, prop) && !Object.hasOwn(target, prop)) {
        return (additions as any)[prop];
      }
      const value = Reflect.get(target, prop, target);
      // Only *inherited* functions are bound, i.e. the ones on the host's
      // prototype chain, which are the ones at risk of being called with the
      // proxy as `this`. An own function property is returned untouched: it is
      // either already bound (a class field holding an arrow) or something
      // deliberately installed on the instance, such as a `jest.spyOn` mock,
      // whose own properties (`mockReturnValue` and friends) a bound copy would
      // strip. `constructor` is excluded too: it is compared by identity
      // (`host.constructor === MyHost`), and binding would hand back a
      // different function object named `bound MyHost`.
      if (typeof value !== 'function' || prop === 'constructor' || Object.hasOwn(target, prop)) {
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
    defineProperty(target, prop, descriptor) {
      // A `jest.spyOn` (and any other redefinition) replaces the property
      // without going through `set`, so the memo has to be dropped here too or
      // the proxy would keep handing out the pre-spy function.
      boundCache.delete(prop);
      return Reflect.defineProperty(target, prop, descriptor);
    },
    deleteProperty(target, prop) {
      boundCache.delete(prop);
      return Reflect.deleteProperty(target, prop);
    },
    has(target, prop) {
      return Object.hasOwn(additions, prop) || Reflect.has(target, prop);
    },
    ownKeys(target) {
      return [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(additions)])];
    },
    // There is deliberately no `getOwnPropertyDescriptor` trap: the additions are
    // reachable through `get` and `has` but are never reported as own properties
    // of the host, so they behave like methods on a prototype. `Object.keys(host)`
    // and `{ ...host }` are therefore unchanged from the unwrapped host, and a
    // tool that installs an override — `jest.spyOn` being the one that matters —
    // sees the property as inherited and so restores it by *deleting* the own
    // copy, which uncovers the addition again rather than pinning a copy of it
    // onto the host (which `additions.notify` would then call, recursing).
  }) as T & IoEmitter;

  WRAPPED.set(host, proxy);
  WRAPPED.set(proxy, proxy);

  return proxy;
}
