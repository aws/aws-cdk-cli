import { IManifestEntry } from './asset-manifest';
import { ShellEventType } from './private/shell';

/**
 * A listener for progress events from the publisher
 */
export interface IPublishProgressListener {
  /**
   * Asset build event
   */
  onPublishEvent(type: EventType, event: IPublishProgress): void;
}

/**
 * A single event for an asset
 */
export enum EventType {
  /**
   * Just starting on an asset
   */
  START = 'start',

  /**
   * When an asset is successfully finished
   */
  SUCCESS = 'success',

  /**
   * When an asset failed
   */
  FAIL = 'fail',

  /**
   * Checking whether an asset has already been published
   */
  CHECK = 'check',

  /**
   * The asset was already published
   */
  FOUND = 'found',

  /**
   * The asset was reused locally from a cached version
   */
  CACHED = 'cached',

  /**
   * The asset will be built
   */
  BUILD = 'build',

  /**
   * The asset will be uploaded
   */
  UPLOAD = 'upload',

  /**
   * Another type of detail message
   */
  DEBUG = 'debug',

  /**
   * When a shell command is executed. Emits the the command line arguments given to
   * the subprocess as a string upon shell execution.
   *
   * Only emitted when subprocessOutputDestination is set to 'publish'
   */
  SHELL_OPEN = 'shell_open',

  /**
   * stdout from a shell command
   *
   * Only emitted when subprocessOutputDestination is set to 'publish'
   */
  SHELL_STDOUT = 'shell_stdout',

  /**
   * stdout from a shell command
   *
   * Only emitted when subprocessOutputDestination is set to 'publish'
   */
  SHELL_STDERR = 'shell_stderr',

  /**
   * When a shell command closes. Emits the the command line arguments given to
   * the subprocess as a string upon shell closure.
   *
   * Only emitted when subprocessOutputDestination is set to 'publish'
   */
  SHELL_CLOSE = 'shell_close',
}

/**
 * A helper function to convert shell events to asset progress events
 * @param event a shell event
 * @returns an {@link EventType}
 */
export function shellEventToEventType(event: ShellEventType): EventType {
  switch (event) {
    case 'open':
      return EventType.SHELL_OPEN;
    case 'close':
      return EventType.SHELL_CLOSE;
    case 'data_stdout':
      return EventType.SHELL_STDOUT;
    case 'data_stderr':
      return EventType.SHELL_STDERR;
  }
}

/**
 * Create a ShellEventPublisher for an {@link EventEmitter}
 *
 * Returns a ShellEventPublisher that translates ShellEvents into messages
 * emitted via the EventEmitter. Uses `shellEventToEventType` to translate
 * shell event types to event types
 */
export function shellEventPublisherFromEventEmitter(eventEmitter: EventEmitter) {
  return (event: ShellEventType, message: string) => {
    const eventType = shellEventToEventType(event);
    eventEmitter(eventType, message);
  };
}

export type EventEmitter = (type: EventType, m: string) => void;

/**
 * Context object for publishing progress
 */
export interface IPublishProgress {
  /**
   * Current event message
   */
  readonly message: string;

  /**
   * Asset currently being packaged (if any)
   */
  readonly currentAsset?: IManifestEntry;

  /**
   * How far along are we?
   */
  readonly percentComplete: number;

  /**
   * Abort the current publishing operation
   */
  abort(): void;
}
