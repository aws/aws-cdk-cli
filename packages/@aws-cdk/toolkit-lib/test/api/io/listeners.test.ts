import type { IIoHost, IMessageMatcher, IoMessage, IoMessageCode, IoRequest } from '../../../lib/api/io';
import { withListeners } from '../../../lib/api/io';

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
      host.on(I2901, (m) => {
        seen.push(m.data);
      });

      await host.notify(notification());

      expect(seen).toHaveLength(1);
      expect(inner.notified).toHaveLength(1);
    });

    test('does not run the listener for a non-matching code', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      host.on(I2901, fn);

      await host.notify(notification({ code: 'CDK_TOOLKIT_I0001' }));

      expect(fn).not.toHaveBeenCalled();
      expect(inner.notified).toHaveLength(1);
    });

    test('awaits async listeners before forwarding', async () => {
      const host = withListeners(inner);
      const order: string[] = [];
      host.on(I2901, async () => {
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
      host.on(I2901, () => {
        order.push(1);
      });
      host.on(I2901, () => {
        order.push(2);
      });
      host.on(I2901, () => {
        order.push(3);
      });

      await host.notify(notification());

      expect(order).toEqual([1, 2, 3]);
    });

    test('the disposer removes the listener', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      const dispose = host.on(I2901, fn);

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

    test('matches on a matcher and delivers the payload typed', async () => {
      const host = withListeners(inner);
      // A matcher carries the payload type, so `msg.data` is `{ stacks }` here
      // without a cast (the point of the matcher overload).
      const matcher: IMessageMatcher<{ stacks: unknown[] }> = {
        is: (m): m is IoMessage<{ stacks: unknown[] }> => m.code === I2901,
      };
      const seen: number[] = [];
      host.on(matcher, (m) => {
        seen.push(m.data.stacks.length);
      });

      await host.notify(notification());
      await host.notify(notification({ code: 'CDK_TOOLKIT_I0001' }));

      expect(seen).toEqual([0]);
    });
  });

  describe('once', () => {
    test('runs only for the first matching message', async () => {
      const host = withListeners(inner);
      const fn = jest.fn();
      host.once(I2901, fn);

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
      host.on(I2901, async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      host.once(I2901, () => {
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
      host.rewrite(I2901, (m) => `rewritten: ${(m.data as { stacks: unknown[] }).stacks.length}`);

      await host.notify(notification());

      expect(inner.notified[0].message).toBe('rewritten: 0');
      expect(inner.notified[0].code).toBe('CDK_TOOLKIT_I2901');
    });

    test('can also override the level', async () => {
      const host = withListeners(inner);
      host.rewrite(I2901, (m) => m.message, 'debug');

      await host.notify(notification());

      expect(inner.notified[0].level).toBe('debug');
    });

    test('does not mutate the caller-provided message', async () => {
      const host = withListeners(inner);
      host.rewrite(I2901, () => 'changed');
      const msg = notification();

      await host.notify(msg);

      expect(msg.message).toBe('the original text');
    });

    test('rewriteOnce applies only once', async () => {
      const host = withListeners(inner);
      host.rewriteOnce(I2901, () => 'changed');

      await host.notify(notification());
      await host.notify(notification());

      expect(inner.notified[0].message).toBe('changed');
      expect(inner.notified[1].message).toBe('the original text');
    });

    test('rewrites accumulate across listeners', async () => {
      const host = withListeners(inner);
      host.rewrite(I2901, (m) => `${m.message}-a`);
      host.rewrite(I2901, (m) => `${m.message}-b`);

      await host.notify(notification());

      expect(inner.notified[0].message).toBe('the original text-a-b');
    });

    test('matching is decided against the emitted message, not an earlier rewrite', async () => {
      const host = withListeners(inner);
      // First listener rewrites the text; a later predicate that keys on the old
      // text must still fire, because matching sees the emitted message.
      host.rewrite(I2901, () => 'changed');
      const fn = jest.fn();
      host.on((m) => m.message === 'the original text', fn);

      await host.notify(notification());

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('preventDefault', () => {
    test('suppresses the forward to the inner host', async () => {
      const host = withListeners(inner);
      host.on(I2901, () => ({ preventDefault: true }));

      await host.notify(notification());

      expect(inner.notified).toHaveLength(0);
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
      host.respond(I7010, true);

      const answer = await host.requestResponse(request({ defaultResponse: false }));

      expect(answer).toBe(true);
      expect(inner.requested).toHaveLength(0);
      expect(inner.notified).toHaveLength(0);
    });

    test('respond with suppressQuestion=false surfaces the question but still answers', async () => {
      const host = withListeners(inner);
      host.respond(I7010, true, { suppressQuestion: false });

      const answer = await host.requestResponse(request({ defaultResponse: false }));

      expect(answer).toBe(true);
      // The inner host is asked to show the question (as a notification), not to prompt.
      expect(inner.notified).toHaveLength(1);
      expect(inner.requested).toHaveLength(0);
    });

    test('respond treats presence of the value as the answer, so false is a valid answer', async () => {
      const host = withListeners(inner);
      host.respond(I7010, false);

      const answer = await host.requestResponse(request({ defaultResponse: true }));

      expect(answer).toBe(false);
      expect(inner.requested).toHaveLength(0);
    });

    test('respondOnce answers only the first request', async () => {
      const host = withListeners(inner);
      inner.prompted = 'PROMPTED';
      host.respondOnce(I7010, false);

      const first = await host.requestResponse(request({ defaultResponse: 'default' }));
      const second = await host.requestResponse(request({ defaultResponse: 'default' }));

      expect(first).toBe(false);
      expect(second).toBe('PROMPTED');
      expect(inner.requested).toHaveLength(1);
    });

    test('a listener can reword a prompt before it reaches the inner host', async () => {
      const host = withListeners(inner);
      host.rewrite(I7010, () => 'reworded question');

      await host.requestResponse(request());

      expect(inner.requested[0].message).toBe('reworded question');
    });

    test('preventDefault on a request resolves with the default response without asking', async () => {
      const host = withListeners(inner);
      host.on(I7010, () => ({ preventDefault: true }));

      const answer = await host.requestResponse(request({ defaultResponse: 'the-default' }));

      expect(answer).toBe('the-default');
      expect(inner.requested).toHaveLength(0);
    });

    test('respond on a notification code leaves the message alone instead of suppressing it', async () => {
      const host = withListeners(inner);
      // I2901 is a notification, not a request: there is nothing to answer, so
      // respond must not drop the message.
      host.respond(I2901, true);

      await host.notify(notification());

      expect(inner.notified).toHaveLength(1);
    });

    test('respondOnce on a notification code leaves the message alone instead of suppressing it', async () => {
      const host = withListeners(inner);
      host.respondOnce(I2901, true);

      await host.notify(notification());

      expect(inner.notified).toHaveLength(1);
    });
  });
});
