interface SessionIdentifiers {
  readonly cdkCliVersion: string;
  readonly cdkLibraryVersion?: string;
  readonly telemetryVersion: string;
  readonly sessionId: string;
  readonly installationId: string;
  readonly region?: string;
}

export interface Identifiers extends SessionIdentifiers {
  readonly eventId: string;
  readonly timestamp: string;
}

type ConfigEntry = { [key: string]: boolean };

export interface Command {
  readonly path: string[];
  readonly parameters: { [key: string]: string };
  readonly config: { [key: string]: ConfigEntry };
}

interface SessionEvent {
  readonly command: Command;
}

export type EventType = 'SYNTH' | 'INVOKE';
export type State = 'ABORTED' | 'FAILED' | 'SUCCEEDED';
interface Event extends SessionEvent {
  readonly state: State;
  readonly eventType: EventType;
}

export interface SessionEnvironment {
  readonly os: {
    readonly platform: string;
    readonly release: string;
  };
  readonly ci: boolean;
  readonly nodeVersion: string;
}

interface Environment extends SessionEnvironment {
}

interface Duration {
  readonly total: number;
  readonly components?: { [key: string]: number };
}

type Counters = { [key: string]: number };

export enum ErrorName {
  TOOLKIT_ERROR = 'ToolkitError',
  AUTHENTICATION_ERROR = 'AuthenticationError',
  ASSEMBLY_ERROR = 'AssemblyError',
  CONTEXT_PROVIDER_ERROR = 'ContextProviderError',
  UNKNOWN_ERROR = 'UnknownError',
}

export interface ErrorDetails {
  readonly name: ErrorName;
  readonly message?: string; // sanitized stack message
  readonly stackTrace?: string; // sanitized stack trace
  readonly logs?: string; // sanitized stack logs
}

interface Dependency {
  readonly name: string;
  readonly version: string;
}

interface SessionProject {
  readonly dependencies?: Dependency[];
}

interface Project extends SessionProject {
}

export interface TelemetrySchema {
  readonly identifiers: Identifiers;
  readonly event: Event;
  readonly environment: Environment;
  readonly project: Project;
  readonly duration: Duration;
  readonly counters?: Counters;
  readonly error?: ErrorDetails;
}

export interface SessionSchema {
  identifiers: SessionIdentifiers;
  event: SessionEvent;
  environment: SessionEnvironment;
  project: SessionProject;
}
