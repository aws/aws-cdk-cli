import type { EmittingIoHost, IIoHost, IoMessage, IoMessageCode, IoRequest } from '../../../lib/api/io';
import { byCode, withListeners } from '../../../lib/api/io';

/**
 * A minimal `IIoHost` that records what it is asked to handle, so we can assert
 * on what a wrapped host forwards to it (after listeners ran).
 */
class RecordingIoHost implements IIoHost {
  public readonly notified: Array<IoMessage<unknown>> = [];
  public readonly requested: Array<IoRequest<unknown, any>> = [];

  /** Response the inner host resolves a request with, standing in for a prompt. */
  public prompted: any = 'PROMPTED';

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    this.notified.push(msg);
  }

  public async requestResponse<T>(msg: IoRequest<unknown, T>): Promise<T> {
    this.requested.push(msg);
    return this.prompted;
  }
}

const I2901: IoMessageCode = 'CDK_TOOLKIT_I2901'; // list result, payload has `stacks`
const I7010: IoMessageCode = 'CDK_TOOLKIT_I7010'; // destroy confirmation request (boolean)

/**
 * `I7010` selected as the yes/no request it is. `respond` only takes a matcher
 * that narrows to `IoRequest`, which is what makes the answer type-checked.
 */
const isConfirm = byCode<IoRequest<void, boolean>>(I7010);

function notification(over: Partial<IoMessage<any>> = {}): IoMessage<any> {
  return {
    time: new Date('2024-01-01T12:00:00'),
    level: 'info',
    action: 'synth',
    code: 'CDK_TOOLKIT_I2901',
    message: 'the original text',
    data: { stacks: [] },
    ...over,
  };
}

function request(over: Partial<IoRequest<any, any>> = {}): IoRequest<any, any> {
  return {
    time: new Date('2024-01-01T12:00:00'),
    level: 'info',
    action: 'destroy',
    code: 'CDK_TOOLKIT_I7010',
    message: 'Are you sure?',
    data: {},
    defaultResponse: true,
    ...over,
  };
}

describe('withListeners', () => {
  let inner: RecordingIoHost;

  beforeEach(() => {
    inner = new RecordingIoHost();
  });

  test('the wrapped host is still an IIoHost that forwards to the inner host', async () => {
    const host = withListeners(inner);
    const msg = notification();

    await host.notify(msg);

    expect(inner.notified).toEqual([msg]);
  });

  describe('on', () => {
    test('runs the listener for a matching code and forwards the message', async () => {
      const host = withListeners(inner);
      const seen: Array<unknown> = [];
      host.on(byCode(I2901), (m) => {
        seen.push(m.data);
      });

      await host.notify(notification());

      expect(seen).toHaveLength(1);
      expect(inner.notified).toHaveLength(1);
    });

    test('does not run the listener for a non-matching code', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      host.on(byCode(I2901), fn);

      await host.notify(notification({ code: 'CDK_TOOLKIT_I0001' }));

      expect(fn).not.toHaveBeenCalled();
      expect(inner.notified).toHaveLength(1);
    });

    test('awaits async listeners before forwarding', async () => {
      const host = withListeners(inner);
      const order: string[] = [];
      host.on(byCode(I2901), async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push('listener');
      });

      await host.notify(notification());
      order.push('forwarded');

      expect(order).toEqual(['listener', 'forwarded']);
    });

    test('runs matching listeners in registration order', async () => {
      const host = withListeners(inner);
      const order: number[] = [];
      host.on(byCode(I2901), () => {
        order.push(1);
      });
      host.on(byCode(I2901), () => {
        order.push(2);
      });
      host.on(byCode(I2901), () => {
        order.push(3);
      });

      await host.notify(notification());

      expect(order).toEqual([1, 2, 3]);
    });

    test('the disposer removes the listener', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      const dispose = host.on(byCode(I2901), fn);

      await host.notify(notification());
      dispose();
      await host.notify(notification());

      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('matches on a predicate selector, firing only for matching messages', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      host.on((m) => m.level === 'warn', fn);

      await host.notify(notification({ level: 'warn' }));
      await host.notify(notification({ level: 'info' }));

      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('a type-guard matcher delivers the payload typed, with no cast', async () => {
      const host = withListeners(inner);
      // A plain type guard is the whole selector concept: nothing named needs to
      // exist for `msg.data` to be `{ stacks }` inside the listener.
      const isList = (m: IoMessage<unknown>): m is IoMessage<{ stacks: unknown[] }> => m.code === I2901;
      const seen: number[] = [];
      host.on(isList, (m) => {
        seen.push(m.data.stacks.length);
      });

      await host.notify(notification());
      await host.notify(notification({ code: 'CDK_TOOLKIT_I0001' }));

      expect(seen).toEqual([0]);
    });

    test('an explicit payload generic types `msg.data` for a plain matcher', async () => {
      const host = withListeners(inner);
      const seen: number[] = [];
      host.on<{ stacks: unknown[] }>(byCode(I2901), (m) => {
        seen.push(m.data.stacks.length);
      });

      await host.notify(notification());

      expect(seen).toEqual([0]);
    });
  });

  describe('matchers', () => {
    test('byCode is variadic and matches any of the given codes', async () => {
      const host = withListeners(inner);
      const seen: Array<string | undefined> = [];
      host.on(byCode(I2901, I7010), (m) => {
        seen.push(m.code);
      });

      await host.notify(notification());
      await host.notify(notification({ code: I7010 }));
      await host.notify(notification({ code: 'CDK_TOOLKIT_I0001' }));

      expect(seen).toEqual([I2901, I7010]);
    });

    test('byCode does not match a message without a code', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      host.on(byCode(I2901), fn);

      await host.notify(notification({ code: undefined }));

      expect(fn).not.toHaveBeenCalled();
    });

    test('byCode with a payload type narrows `msg.data` in the listener', async () => {
      const host = withListeners(inner);
      const seen: number[] = [];
      // No generic on `on` and no cast: the guard `byCode` returns carries the
      // payload type.
      host.on(byCode<{ stacks: unknown[] }>(I2901), (m) => {
        seen.push(m.data.stacks.length);
      });

      await host.notify(notification());

      expect(seen).toEqual([0]);
    });
  });

  describe('once', () => {
    test('runs only for the first matching message', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      host.once(byCode(I2901), fn);

      await host.notify(notification());
      await host.notify(notification());

      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('accepts a predicate selector', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      host.once((m) => m.level === 'warn', fn);

      await host.notify(notification({ level: 'warn' }));
      await host.notify(notification({ level: 'warn' }));

      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('fires only once even when two messages are handled concurrently', async () => {
      const host = withListeners(inner);
      let calls = 0;
      // An async listener ahead of the `once` makes both notifies overlap.
      host.on(byCode(I2901), async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      host.once(byCode(I2901), () => {
        calls++;
      });

      // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism -- fixed pair, to force overlap
      await Promise.all([host.notify(notification()), host.notify(notification())]);

      expect(calls).toBe(1);
    });
  });

  describe('rewrite', () => {
    test('replaces the forwarded message text, leaving the code intact', async () => {
      const host = withListeners(inner);
      host.rewrite(byCode(I2901), (m) => `rewritten: ${(m.data as { stacks: unknown[] }).stacks.length}`);

      await host.notify(notification());

      expect(inner.notified[0].message).toBe('rewritten: 0');
      expect(inner.notified[0].code).toBe('CDK_TOOLKIT_I2901');
    });

    test('can also override the level', async () => {
      const host = withListeners(inner);
      host.rewrite(byCode(I2901), (m) => m.message, { level: 'debug' });

      await host.notify(notification());

      expect(inner.notified[0].level).toBe('debug');
    });

    test('does not mutate the caller-provided message', async () => {
      const host = withListeners(inner);
      host.rewrite(byCode(I2901), () => 'changed');
      const msg = notification();

      await host.notify(msg);

      expect(msg.message).toBe('the original text');
    });

    test('rewriteOnce applies only once', async () => {
      const host = withListeners(inner);
      host.rewriteOnce(byCode(I2901), () => 'changed');

      await host.notify(notification());
      await host.notify(notification());

      expect(inner.notified[0].message).toBe('changed');
      expect(inner.notified[1].message).toBe('the original text');
    });

    test('rewrites accumulate across listeners', async () => {
      const host = withListeners(inner);
      host.rewrite(byCode(I2901), (m) => `${m.message}-a`);
      host.rewrite(byCode(I2901), (m) => `${m.message}-b`);

      await host.notify(notification());

      expect(inner.notified[0].message).toBe('the original text-a-b');
    });

    test('matching is decided against the emitted message, not an earlier rewrite', async () => {
      const host = withListeners(inner);
      // First listener rewrites the text; a later predicate that keys on the old
      // text must still fire, because matching sees the emitted message.
      host.rewrite(byCode(I2901), () => 'changed');
      const fn = jest.fn();
      host.on((m) => m.message === 'the original text', fn);

      await host.notify(notification());

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('preventDefault', () => {
    test('suppresses the forward to the inner host', async () => {
      const host = withListeners(inner);
      host.on(byCode(I2901), () => ({ preventDefault: true }));

      await host.notify(notification());

      expect(inner.notified).toHaveLength(0);
    });
  });

  describe('dispatch contract', () => {
    test('a listener that throws aborts the dispatch and the error reaches the emitter', async () => {
      const host = withListeners(inner);
      const later = jest.fn();
      host.on(byCode(I2901), () => {
        throw new Error('listener exploded');
      });
      host.on(byCode(I2901), later);

      await expect(host.notify(notification())).rejects.toThrow('listener exploded');

      expect(later).not.toHaveBeenCalled();
      expect(inner.notified).toHaveLength(0);
    });

    test('a rejected async listener aborts the dispatch too', async () => {
      const host = withListeners(inner);
      host.on(byCode(I2901), async () => {
        throw new Error('async explosion');
      });

      await expect(host.notify(notification())).rejects.toThrow('async explosion');

      expect(inner.notified).toHaveLength(0);
    });

    test('a listener registered during dispatch does not see the message being dispatched', async () => {
      const host = withListeners(inner);
      const late = jest.fn();
      host.on(byCode(I2901), () => {
        host.on(byCode(I2901), late);
      });

      await host.notify(notification());

      expect(late).not.toHaveBeenCalled();

      // But it does see the next one.
      await host.notify(notification());

      expect(late).toHaveBeenCalledTimes(1);
    });

    test('a listener disposed during dispatch still runs for the message being dispatched', async () => {
      const host = withListeners(inner);
      const later = jest.fn();
      // The first listener removes the second one, which is already part of this
      // dispatch. Like `EventEmitter`, the set of listeners is snapshotted when
      // the message arrives, so the removal only takes effect from the next one.
      let dispose: () => void;
      host.on(byCode(I2901), () => {
        dispose();
      });
      dispose = host.on(byCode(I2901), later);

      await host.notify(notification());

      expect(later).toHaveBeenCalledTimes(1);

      await host.notify(notification());

      expect(later).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestResponse', () => {
    test('forwards to the inner host when no listener answers', async () => {
      const host = withListeners(inner);
      inner.prompted = false;

      const answer = await host.requestResponse(request());

      expect(inner.requested).toHaveLength(1);
      expect(answer).toBe(false);
    });

    test('respond answers without asking the inner host, suppressing the question', async () => {
      const host = withListeners(inner);
      host.respond(isConfirm, true);

      const answer = await host.requestResponse(request({ defaultResponse: false }));

      expect(answer).toBe(true);
      expect(inner.requested).toHaveLength(0);
      expect(inner.notified).toHaveLength(0);
    });

    test('respond with { showQuestion: true } surfaces the question but still answers', async () => {
      const host = withListeners(inner);
      host.respond(isConfirm, true, { showQuestion: true });

      const answer = await host.requestResponse(request({ defaultResponse: false }));

      expect(answer).toBe(true);
      // The inner host is asked to show the question (as a notification), not to prompt.
      expect(inner.notified).toHaveLength(1);
      expect(inner.requested).toHaveLength(0);
    });

    test('respond treats presence of the value as the answer, so false is a valid answer', async () => {
      const host = withListeners(inner);
      host.respond(isConfirm, false);

      const answer = await host.requestResponse(request({ defaultResponse: true }));

      expect(answer).toBe(false);
      expect(inner.requested).toHaveLength(0);
    });

    test('respondOnce answers only the first request', async () => {
      const host = withListeners(inner);
      inner.prompted = 'PROMPTED';
      host.respondOnce(isConfirm, false);

      const first = await host.requestResponse(request({ defaultResponse: 'default' }));
      const second = await host.requestResponse(request({ defaultResponse: 'default' }));

      expect(first).toBe(false);
      expect(second).toBe('PROMPTED');
      expect(inner.requested).toHaveLength(1);
    });

    test('a listener can reword a prompt before it reaches the inner host', async () => {
      const host = withListeners(inner);
      host.rewrite(byCode(I7010), () => 'reworded question');

      await host.requestResponse(request());

      expect(inner.requested[0].message).toBe('reworded question');
    });

    test('preventDefault on a request resolves with the default response without asking', async () => {
      const host = withListeners(inner);
      host.on(byCode(I7010), () => ({ preventDefault: true }));

      const answer = await host.requestResponse(request({ defaultResponse: 'the-default' }));

      expect(answer).toBe('the-default');
      expect(inner.requested).toHaveLength(0);
    });

    test('respond on a notification code leaves the message alone instead of suppressing it', async () => {
      const host = withListeners(inner);
      // I2901 is a notification, not a request. The types cannot catch a caller
      // claiming otherwise, so the runtime must: there is nothing to answer, so
      // respond leaves the message alone rather than dropping it.
      host.respond(byCode<IoRequest<void, boolean>>(I2901), true);

      await host.notify(notification());

      expect(inner.notified).toHaveLength(1);
    });

    test('respondOnce on a notification code leaves the message alone instead of suppressing it', async () => {
      const host = withListeners(inner);
      host.respondOnce(byCode<IoRequest<void, boolean>>(I2901), true);

      await host.notify(notification());

      expect(inner.notified).toHaveLength(1);
    });

    test('when two listeners answer the same request, the last one wins', async () => {
      const host = withListeners(inner);
      host.respond(isConfirm, false);
      host.respond(isConfirm, true);

      const answer = await host.requestResponse(request({ defaultResponse: false }));

      expect(answer).toBe(true);
      expect(inner.requested).toHaveLength(0);
    });
  });

  describe('action override', () => {
    test('reaches the effective message forwarded to the inner host', async () => {
      const host = withListeners(inner);
      host.on(byCode(I2901), () => ({ action: 'metadata' as const }));

      await host.notify(notification({ action: 'list' }));

      expect(inner.notified[0].action).toBe('metadata');
    });

    test('matching still keys off the emitted action, not the override', async () => {
      const host = withListeners(inner);
      host.on(byCode(I2901), () => ({ action: 'metadata' as const }));
      const fn = jest.fn();
      host.on((m) => m.action === 'metadata', fn);

      await host.notify(notification({ action: 'list' }));

      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('DisposeListener', () => {
    test('removes the listener when the `using` scope exits, including on a throw', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();

      await expect((async () => {
        using _listener = host.on(byCode(I2901), fn);
        await host.notify(notification());
        throw new Error('boom');
      })()).rejects.toThrow('boom');

      await host.notify(notification());

      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('is idempotent: disposing twice does not remove a later listener', async () => {
      const host = withListeners(inner);
      const first = jest.fn();
      const second = jest.fn();
      const dispose = host.on(byCode(I2901), first);
      dispose();
      host.on(byCode(I2901), second);
      dispose();

      await host.notify(notification());

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe('the returned host is the host you passed in', () => {
    class ChattyIoHost extends RecordingIoHost {
      public logLevel = 'info';
      private greeting = 'hello';

      public get shout(): string {
        return this.greeting.toUpperCase();
      }

      public set salutation(value: string) {
        this.greeting = value;
      }

      public greet(name: string): string {
        return `${this.greeting}, ${name}`;
      }
    }

    test('methods keep working, with `this` bound to the inner host', () => {
      const chatty = new ChattyIoHost();
      const host = withListeners(chatty);

      expect(host.greet('world')).toBe('hello, world');
    });

    test('getters and setters keep working and act on the inner host', () => {
      const chatty = new ChattyIoHost();
      const host = withListeners(chatty);

      expect(host.shout).toBe('HELLO');

      host.salutation = 'howdy';

      expect(host.shout).toBe('HOWDY');
      expect(chatty.greet('world')).toBe('howdy, world');
    });

    test('plain properties can be read and written through the wrapper', () => {
      const chatty = new ChattyIoHost();
      const host = withListeners(chatty);

      host.logLevel = 'trace';

      expect(chatty.logLevel).toBe('trace');
    });

    test('`in` reports both the inner members and the added ones', () => {
      const host = withListeners(new ChattyIoHost());

      expect('greet' in host).toBe(true);
      expect('on' in host).toBe(true);
      expect('nope' in host).toBe(false);
    });

    test('the inner class is still reported by `instanceof` and `constructor`', () => {
      const host = withListeners(new ChattyIoHost());

      expect(host).toBeInstanceOf(ChattyIoHost);
      expect(host).toBeInstanceOf(RecordingIoHost);
      expect(host.constructor).toBe(ChattyIoHost);
      expect(host.constructor.name).toBe('ChattyIoHost');
    });

    test('inherited object methods still come from the inner host, not from the additions', () => {
      const chatty = new ChattyIoHost();
      const host = withListeners(chatty);

      // A regression guard: the additions are a plain object literal, so
      // resolving them with `in` rather than `Object.hasOwn` would shadow
      // everything inherited from `Object.prototype`.
      expect(host.toString()).toBe('[object Object]');
      expect(host.valueOf()).toBe(chatty);
    });

    test('the added methods are not enumerable, so spreading is unchanged', () => {
      const chatty = new ChattyIoHost();
      const host = withListeners(chatty);

      expect(Object.keys(host)).toEqual(Object.keys(chatty));
      expect(Object.keys({ ...host })).toEqual(Object.keys({ ...chatty }));
      expect(Object.keys(host)).not.toContain('on');
    });

    test('method identity is stable, so a forwarded method can be used as a callback', () => {
      const host = withListeners(new ChattyIoHost());

      expect(host.greet).toBe(host.greet);
      expect(host.on).toBe(host.on);
    });

    test('overwriting a method through the wrapper takes effect', () => {
      const chatty = new ChattyIoHost();
      const host = withListeners(chatty);

      // Read once so the original is memoized, then replace it.
      expect(host.greet('world')).toBe('hello, world');
      host.greet = (name: string) => `bye, ${name}`;

      expect(host.greet('world')).toBe('bye, world');
      expect(chatty.greet('world')).toBe('bye, world');
    });

    test('the wrapped host is assignable to EmittingIoHost of the inner type', async () => {
      // The alias exists so callers can name a wrapped host in their own
      // signatures without spelling out the intersection.
      const host: EmittingIoHost<ChattyIoHost> = withListeners(new ChattyIoHost());

      expect(host.greet('world')).toBe('hello, world');
      await host.notify(notification());

      expect(host.notified).toHaveLength(1);
    });

    test('wrapping the same host twice returns the same wrapper', () => {
      expect(withListeners(inner)).toBe(withListeners(inner));
    });

    test('wrapping is idempotent, so a second wrap does not double-handle messages', async () => {
      const once = withListeners(inner);
      const twice = withListeners(once);

      expect(twice).toBe(once);

      const fn = jest.fn();
      twice.on(byCode(I2901), fn);
      await twice.notify(notification());

      expect(fn).toHaveBeenCalledTimes(1);
      expect(inner.notified).toHaveLength(1);
    });

    test('listeners registered before the second wrap still fire through it', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      host.on(byCode(I2901), fn);

      await withListeners(host).notify(notification());

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
