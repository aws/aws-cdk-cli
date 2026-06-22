import type { Request, Response } from 'express';

/**
 * SSE event name signalling that the cloud assembly was rewritten. The event
 * carries no payload: the web server holds no assembly state, so a client
 * re-fetches the construct tree and violations through the regular GET
 * endpoints whenever it sees this.
 */
export const ASSEMBLY_CHANGED = 'assembly-changed';

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
  public readonly handle = (req: Request, res: Response): void => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    this.clients.add(res);

    const remove = (): void => {
      this.clients.delete(res);
    };
    req.on('close', remove);
    // A client that vanishes mid-broadcast surfaces here as a socket error.
    // Drop it and swallow the error rather than crashing the server on an
    // otherwise-unhandled 'error' event.
    res.on('error', remove);
  };

  /** Push a named, payload-free event to every connected client. */
  public broadcast(eventName: string): void {
    const frame = `event: ${eventName}\ndata: {}\n\n`;
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
