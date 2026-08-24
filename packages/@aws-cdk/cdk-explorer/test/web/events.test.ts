import type { Request, Response } from 'express';
import { MAX_SSE_CLIENTS, SseBroadcaster } from '../../lib/web/events';
import { ASSEMBLY_CHANGED } from '../../lib/web/protocol';

/**
 * Minimal Request/Response doubles that capture writes and expose the close and
 * error handlers the broadcaster registers, so behavior is verified without a
 * real socket.
 */
function fakeClient() {
  const writes: string[] = [];
  let ended = false;
  const reqHandlers: Record<string, () => void> = {};
  const resHandlers: Record<string, (err?: unknown) => void> = {};

  const req = {
    on: (event: string, handler: () => void) => {
      reqHandlers[event] = handler;
      return req;
    },
  } as unknown as Request;

  let statusCode: number | undefined;
  let jsonBody: unknown;

  const res = {
    set: () => res,
    flushHeaders: () => undefined,
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      jsonBody = body;
      return res;
    },
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    end: () => {
      ended = true;
    },
    on: (event: string, handler: (err?: unknown) => void) => {
      resHandlers[event] = handler;
      return res;
    },
  } as unknown as Response;

  return {
    req,
    res,
    writes,
    isEnded: () => ended,
    getStatus: () => statusCode,
    getJson: () => jsonBody,
    disconnect: () => reqHandlers.close?.(),
    fail: () => resHandlers.error?.(new Error('broken pipe')),
  };
}

const FRAME = `event: ${ASSEMBLY_CHANGED}\ndata: {}\n\n`;

describe('SseBroadcaster', () => {
  test('broadcasts a named, payload-free frame to every connected client', () => {
    const broadcaster = new SseBroadcaster();
    const a = fakeClient();
    const b = fakeClient();
    broadcaster.handle(a.req, a.res);
    broadcaster.handle(b.req, b.res);

    broadcaster.broadcast(ASSEMBLY_CHANGED);

    expect(a.writes).toEqual([FRAME]);
    expect(b.writes).toEqual([FRAME]);
  });

  test('stops writing to a client after it disconnects', () => {
    const broadcaster = new SseBroadcaster();
    const gone = fakeClient();
    const live = fakeClient();
    broadcaster.handle(gone.req, gone.res);
    broadcaster.handle(live.req, live.res);

    gone.disconnect();
    broadcaster.broadcast(ASSEMBLY_CHANGED);

    expect(gone.writes).toEqual([]);
    expect(live.writes).toEqual([FRAME]);
  });

  test('drops a client whose socket errors so a broken pipe is not written again', () => {
    const broadcaster = new SseBroadcaster();
    const a = fakeClient();
    broadcaster.handle(a.req, a.res);

    a.fail();
    broadcaster.broadcast(ASSEMBLY_CHANGED);

    expect(a.writes).toEqual([]);
  });

  test('close ends every open stream and reaches no one afterwards', () => {
    const broadcaster = new SseBroadcaster();
    const a = fakeClient();
    const b = fakeClient();
    broadcaster.handle(a.req, a.res);
    broadcaster.handle(b.req, b.res);

    broadcaster.close();

    expect(a.isEnded()).toBe(true);
    expect(b.isEnded()).toBe(true);

    broadcaster.broadcast(ASSEMBLY_CHANGED);
    expect(a.writes).toEqual([]);
    expect(b.writes).toEqual([]);
  });

  test(`refuses a stream past ${MAX_SSE_CLIENTS} subscribers instead of growing the set`, () => {
    const broadcaster = new SseBroadcaster();
    const accepted = Array.from({ length: MAX_SSE_CLIENTS }, () => fakeClient());
    for (const client of accepted) {
      broadcaster.handle(client.req, client.res);
    }

    const refused = fakeClient();
    broadcaster.handle(refused.req, refused.res);

    expect(refused.getStatus()).toBe(503);
    expect((refused.getJson() as { error: string }).error).toMatch(/too many/);

    broadcaster.broadcast(ASSEMBLY_CHANGED);
    expect(refused.writes).toEqual([]);
    expect(accepted[0].writes).toEqual([FRAME]);

    broadcaster.close();
  });

  test('admits a new stream once a subscriber disconnects', () => {
    const broadcaster = new SseBroadcaster();
    const accepted = Array.from({ length: MAX_SSE_CLIENTS }, () => fakeClient());
    for (const client of accepted) {
      broadcaster.handle(client.req, client.res);
    }
    accepted[0].disconnect();

    const admitted = fakeClient();
    broadcaster.handle(admitted.req, admitted.res);

    expect(admitted.getStatus()).toBeUndefined();
    broadcaster.broadcast(ASSEMBLY_CHANGED);
    expect(admitted.writes).toEqual([FRAME]);

    broadcaster.close();
  });
});

describe('SseBroadcaster heartbeat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('writes a comment frame to every open stream on the interval', () => {
    const broadcaster = new SseBroadcaster();
    const a = fakeClient();
    broadcaster.handle(a.req, a.res);

    jest.advanceTimersByTime(30_000);

    expect(a.writes).toEqual([': heartbeat\n\n']);
    broadcaster.close();
  });

  test('stops the interval once the last client leaves, so nothing is left running', () => {
    const broadcaster = new SseBroadcaster();
    const a = fakeClient();
    broadcaster.handle(a.req, a.res);

    a.disconnect();
    jest.advanceTimersByTime(120_000);

    expect(jest.getTimerCount()).toBe(0);
    expect(a.writes).toEqual([]);
  });

  test('stops the interval on close', () => {
    const broadcaster = new SseBroadcaster();
    const a = fakeClient();
    broadcaster.handle(a.req, a.res);

    broadcaster.close();

    expect(jest.getTimerCount()).toBe(0);
  });
});
