import { ITelemetryClient } from "./client-interface";
import { SessionSchema, TelemetryEvent } from "./schema";

export interface TelemetrySessionProps {
  readonly client: ITelemetryClient;
  readonly info: SessionSchema;
}

export class TelemetrySession {
  private readonly client: ITelemetryClient;
  private readonly info: SessionSchema;
  private count = 0;

  constructor(props: TelemetrySessionProps) {
    this.client = props.client;
    this.info = props.info;
  }

  public emit(event: TelemetryEvent): Promise<boolean> {
    this.count += 1;
    return this.client.emit({
      event: {
        command: this.info.event.command,
        state: event.error ? 'SUCCEEDED' : 'FAILED',
        eventType: event.eventType,
      },
      identifiers: {
        ...this.info.identifiers,
        eventId: `${this.info.identifiers.sessionId}:${this.count}`,
        timestamp: new Date().toISOString(),
      },
      environment: this.info.environment,
      project: this.info.project,
      duration: {
        total: event.duration,
      },
      ...( event.error ? {
        error: {
          name: event.error.name,
        },
      } : {}),
    });
  }
}
