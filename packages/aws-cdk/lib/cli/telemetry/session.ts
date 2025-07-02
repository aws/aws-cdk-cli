import { ITelemetryClient } from "./client-interface";
import { EventType, SessionSchema, State } from "./schema";

export interface TelemetrySessionProps {
  readonly client: ITelemetryClient;
  readonly info: SessionSchema;
}

interface TelemetryEvent {
  readonly eventType: EventType;
  readonly duration: number;
  readonly error?: Error,
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
        state: getState(event.error),
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

function getState(error?: Error): State {
  if (error) {
    return error.cause === 'ABORTED' ? 'ABORTED' : 'FAILED';
  }
  return 'SUCCEEDED';
}