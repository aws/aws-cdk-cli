import type { Request, Response } from 'express';
import { SYNTH_STATUS, type SseEventName, type SynthStatusEvent } from './protocol';

/** Max stderr we put on the wire; subprocess output is unbounded, so bound it. */
const MAX_SYNTH_DETAILS_CHARS = 64 * 1024;

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
   * Push a payload-less named event to every client. The `data: {}` line is
   * required: EventSource does not dispatch a named event whose data buffer is
   * empty, so it is what fires the client's listener. Writing to an already
   * disconnected client is a harmless no-op; `handle`'s handlers do the eviction.
   */
  public broadcast(event: SseEventName): void {
    this.send(`event: ${event}\ndata: {}\n\n`);
  }

  /** Push a SYNTH_STATUS event carrying a failed synth's summary + stderr. */
  public broadcastSynthStatus(payload: SynthStatusEvent): void {
    const details = payload.details && payload.details.length > MAX_SYNTH_DETAILS_CHARS
      ? `${payload.details.slice(0, MAX_SYNTH_DETAILS_CHARS)}\n…truncated`
      : payload.details;
    this.send(`event: ${SYNTH_STATUS}\ndata: ${JSON.stringify({ message: payload.message, details })}\n\n`);
  }

  private send(frame: string): void {
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
