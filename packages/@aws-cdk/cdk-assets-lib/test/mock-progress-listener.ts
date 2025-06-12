import type { EventType } from '../lib';
import type { IPublishProgress, IPublishProgressListener } from '../lib/progress';

/**
 * Represents a logged message with additional metadata purely for testing purposes.
 */
export interface LoggedMessage {
  /**
   * The {@link EventType} of the logged message
   */
  readonly type: EventType;

  /**
   * The message text
   */
  readonly message: string;

  /**
   * The stream this message would have been logged to, if cdk-assets was run from the CLI
   */
  readonly stream: 'stdout' | 'stderr';
}

/**
 * Mock implementation of IPublishProgressListener that captures events for testing purposes.
 */
export class MockProgressListener implements IPublishProgressListener {
  public messages: LoggedMessage[] = [];

  onPublishEvent(type: EventType, event: IPublishProgress): void {
    this.messages.push({
      type,
      message: event.message,
      stream: ['open', 'data_stdout', 'close'].includes(type) ? 'stdout' : 'stderr',
    });
  }

  /**
   * Clear captured messages
   */
  clear(): void {
    this.messages = [];
  }
}
