import type { Request, Response } from 'express';
import { ASSEMBLY_CHANGED, SseBroadcaster } from '../../lib/web/events';

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

  const res = {
    set: () => res,
    flushHeaders: () => undefined,
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
});
