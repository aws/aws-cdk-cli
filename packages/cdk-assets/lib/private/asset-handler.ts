import { DockerFactory } from './docker';
import { IAws } from '../aws';
import { EventEmitter } from '../progress';

/**
 * Options for publishing an asset.
 */
export interface PublishOptions {
  /**
   * Whether or not to allow cross account publishing. That is,
   * publish to a bucket belonging to a different account than the target account.
   *
   * @default true
   */
  readonly allowCrossAccount?: boolean;
}

/**
 * Handler for asset building and publishing.
 */
export interface IAssetHandler {
  /**
   * Build the asset.
   */
  build(): Promise<void>;

  /**
   * Publish the asset.
   */
  publish(options?: PublishOptions): Promise<void>;

  /**
   * Return whether the asset already exists
   */
  isPublished(): Promise<boolean>;
}

export interface IHandlerHost {
  readonly aws: IAws;
  readonly aborted: boolean;
  readonly dockerFactory: DockerFactory;

  emitMessage: EventEmitter;
}

export interface IHandlerOptions {
  /**
   * Where to send output of a subprocesses
   *
   * @default 'stdio'
   */
  readonly subprocessOutputDestination: SubprocessOutputDestination;
}

/**
 * The potential destinations for subprocess output.
 *
 * 'stdio' will send output directly to stdout/stderr,
 * 'publish' will publish the output to the {@link IPublishProgressListener},
 * 'ignore' will ignore the output, and emit it nowhere.
 */
export type SubprocessOutputDestination = 'stdio' | 'ignore' | 'publish';
