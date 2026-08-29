import type { Request, Response } from 'express';
import type { SseEventName } from './protocol';

/**
 * Simultaneous streams one explorer will hold open. The model is one developer
 * with a handful of browser tabs, so this is far above any real use while
 * bounding what a script hammering `/api/events` can pin in memory.
 */
export const MAX_SSE_CLIENTS = 32;

/**
 * How often to write an SSE comment to every stream. Keeps intermediaries from
 * idling the connection out, and surfaces a client that vanished without a FIN
 * (sleep, killed VM) as a socket error, which evicts it.
 */
const HEARTBEAT_MS = 30_000;

/**
 * Tracks connected Server-Sent Events clients and pushes events to all of them.
 * One instance lives per web server. `close()` ends every open stream on
 * shutdown so the HTTP server can stop cleanly.
 */
export class SseBroadcaster {
  private readonly clients = new Set<Response>();
  /** Shared across all clients; runs only while at least one is connected. */
  private heartbeat: NodeJS.Timeout | undefined;

  /**
   * Express handler for `GET /api/events`. Opens a long-lived SSE stream and
   * registers the client, removing it when the request closes or the socket
   * errors so a vanished client is never written to. Refuses (503) once
   * {@link MAX_SSE_CLIENTS} streams are already open.
   */
  public handle(req: Request, res: Response): void {
    if (this.clients.size >= MAX_SSE_CLIENTS) {
      res.status(503).json({ error: `too many event subscribers (limit ${MAX_SSE_CLIENTS})` });
      return;
    }
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();
    this.clients.add(res);
    this.startHeartbeat();

    const remove = (): void => {
      this.clients.delete(res);
      if (this.clients.size === 0) {
        this.stopHeartbeat();
      }
    };
    req.on('close', remove);
    // Evict on socket error too, so a vanished client is never written to.
    res.on('error', remove);
  }

  /**
   * Push an event to every connected client. The `data: {}` line is required:
   * EventSource does not dispatch a named event whose data buffer is empty, so
   * the empty payload is what makes the client's listener fire. Writing to a
   * client that already disconnected is a harmless no-op (returns false, does
   * not throw); the `close`/`error` handlers in `handle` do the eviction.
   */
  public broadcast(event: SseEventName): void {
    const frame = `event: ${event}\ndata: {}\n\n`;
    for (const client of this.clients) {
      client.write(frame);
    }
  }

  /** End every open stream and forget the clients. Called on server shutdown. */
  public close(): void {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
    this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    // unref'd: an open stream must not be what keeps the process (or a test run)
    // alive — shutdown is driven by close(), not by the last client leaving.
    this.heartbeat = setInterval(() => {
      // An SSE comment: clients ignore it, but the write fails on a dead socket,
      // which fires `error` and evicts the client.
      for (const client of this.clients) {
        client.write(': heartbeat\n\n');
      }
    }, HEARTBEAT_MS).unref();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}
