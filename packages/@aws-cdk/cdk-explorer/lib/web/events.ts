import type { Request, Response } from 'express';
import type { SseEventName } from './protocol';

/**
 * Tracks connected Server-Sent Events clients and pushes events to all of them.
 * One instance lives per web server. `close()` ends every open stream on
 * shutdown so the HTTP server can stop cleanly.
 */
export class SseBroadcaster {
  private readonly clients = new Set<Response>();

  /**
   * Express handler for `GET /api/events`. Opens a long-lived SSE stream and
   * registers the client, removing it when the request closes or the socket
   * errors so a vanished client is never written to.
   */
  public handle(req: Request, res: Response): void {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();
    this.clients.add(res);

    const remove = (): void => {
      this.clients.delete(res);
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
  }
}
