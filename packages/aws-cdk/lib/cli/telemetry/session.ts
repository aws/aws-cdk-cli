import { EventType, SessionSchema, State } from "./schema";
import { ITelemetrySink } from "./sink-interface";

export interface TelemetrySessionProps {
  readonly client: ITelemetrySink;
  readonly info: SessionSchema;
}

interface TelemetryEvent {
  readonly eventType: EventType;
  readonly duration: number;
  readonly error?: Error,
}

export class TelemetrySession {
  private readonly client: ITelemetrySink;
  private readonly info: SessionSchema;
  private count = 0;

  constructor(props: TelemetrySessionProps) {
    this.client = props.client;
    this.info = props.info;
  }

  public async emit(event: TelemetryEvent): Promise<boolean> {
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

  public async flush(): Promise<void> {
    return this.client.flush();
  }
}

function getState(error?: Error): State {
  if (error) {
    return error.cause === 'ABORTED' ? 'ABORTED' : 'FAILED';
  }
  return 'SUCCEEDED';
}