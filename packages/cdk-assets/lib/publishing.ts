import { AssetManifest, IManifestEntry } from './asset-manifest';
import { IAws } from './aws';
import {
  IAssetHandler,
  IHandlerHost,
  type PublishOptions,
  SubprocessOutputDestination,
} from './private/asset-handler';
import { DockerFactory } from './private/docker';
import { makeAssetHandler } from './private/handlers';
import { pLimit } from './private/p-limit';
import { EventType, IPublishProgress, IPublishProgressListener } from './progress';

export interface AssetPublishingOptions {
  /**
   * Entry point for AWS client
   */
  readonly aws: IAws;

  /**
   * Listener for progress events
   *
   * @default No listener
   */
  readonly progressListener?: IPublishProgressListener;

  /**
   * Whether to throw at the end if there were errors
   *
   * @default true
   */
  readonly throwOnError?: boolean;

  /**
   * Whether to publish in parallel, when 'publish()' is called
   *
   * @default false
   */
  readonly publishInParallel?: boolean;

  /**
   * Whether to build assets, when 'publish()' is called
   *
   * @default true
   */
  readonly buildAssets?: boolean;

  /**
   * Whether to publish assets, when 'publish()' is called
   *
   * @default true
   */
  readonly publishAssets?: boolean;

  /**
   * @deprecated use {@link #subprocessOutputDestination} instead
   */
  readonly quiet?: boolean;

  /**
   * Where to send output of a subprocesses
   *
   * @default 'stdio'
   */
  subprocessOutputDestination?: SubprocessOutputDestination;
}

/**
 * A failure to publish an asset
 */
export interface FailedAsset {
  /**
   * The asset that failed to publish
   */
  readonly asset: IManifestEntry;

  /**
   * The failure that occurred
   */
  readonly error: Error;
}

export class AssetPublishing implements IPublishProgress {
  /**
   * The message for the IPublishProgress interface
   */
  public message: string = 'Starting';

  /**
   * The current asset for the IPublishProgress interface
   */
  public currentAsset?: IManifestEntry;
  public readonly failures = new Array<FailedAsset>();
  private readonly assets: IManifestEntry[];

  private readonly totalOperations: number;
  private completedOperations: number = 0;
  private aborted = false;
  private readonly handlerHost: IHandlerHost;
  private readonly publishInParallel: boolean;
  private readonly buildAssets: boolean;
  private readonly publishAssets: boolean;
  private readonly handlerCache = new Map<IManifestEntry, IAssetHandler>();

  constructor(
    private readonly manifest: AssetManifest,
    private readonly options: AssetPublishingOptions,
  ) {
    this.assets = manifest.entries;
    this.totalOperations = this.assets.length;
    this.publishInParallel = options.publishInParallel ?? false;
    this.buildAssets = options.buildAssets ?? true;
    this.publishAssets = options.publishAssets ?? true;

    const self = this;
    this.handlerHost = {
      aws: this.options.aws,
      get aborted() {
        return self.aborted;
      },
      emitMessage(t, m) {
        self.progressEvent(t, m);
      },
      dockerFactory: new DockerFactory(),
    };
  }

  /**
   * Publish all assets from the manifest
   */
  public async publish(options: PublishOptions = {}): Promise<void> {
    if (this.publishInParallel) {
      const limit = pLimit(20);
      // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
      await Promise.all(
        this.assets.map((asset) => limit(async () => this.publishAsset(asset, options))),
      );
    } else {
      for (const asset of this.assets) {
        if (!(await this.publishAsset(asset, options))) {
          break;
        }
      }
    }

    if ((this.options.throwOnError ?? true) && this.failures.length > 0) {
      throw new Error(`Error publishing: ${this.failures.map((e) => e.error.message)}`);
    }
  }

  /**
   * Build a single asset from the manifest
   */
  public async buildEntry(asset: IManifestEntry) {
    try {
      if (this.progressEvent(EventType.START, `Building ${asset.id}`)) {
        return false;
      }

      const handler = this.assetHandler(asset);
      await handler.build();

      if (this.aborted) {
        throw new Error('Aborted');
      }

      this.completedOperations++;
      if (this.progressEvent(EventType.SUCCESS, `Built ${asset.id}`)) {
        return false;
      }
    } catch (e: any) {
      this.failures.push({ asset, error: e });
      this.completedOperations++;
      if (this.progressEvent(EventType.FAIL, e.message)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Publish a single asset from the manifest
   */
  public async publishEntry(asset: IManifestEntry, options: PublishOptions = {}) {
    try {
      if (this.progressEvent(EventType.START, `Publishing ${asset.id}`)) {
        return false;
      }

      const handler = this.assetHandler(asset);
      await handler.publish(options);

      if (this.aborted) {
        throw new Error('Aborted');
      }

      this.completedOperations++;
      if (this.progressEvent(EventType.SUCCESS, `Published ${asset.id}`)) {
        return false;
      }
    } catch (e: any) {
      this.failures.push({ asset, error: e });
      this.completedOperations++;
      if (this.progressEvent(EventType.FAIL, e.message)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Return whether a single asset is published
   */
  public isEntryPublished(asset: IManifestEntry) {
    const handler = this.assetHandler(asset);
    return handler.isPublished();
  }

  /**
   * publish an asset (used by 'publish()')
   * @param asset The asset to publish
   * @returns false when publishing should stop
   */
  private async publishAsset(asset: IManifestEntry, options: PublishOptions = {}) {
    try {
      if (this.progressEvent(EventType.START, `Publishing ${asset.id}`)) {
        return false;
      }

      const handler = this.assetHandler(asset);

      if (this.buildAssets) {
        await handler.build();
      }

      if (this.publishAssets) {
        await handler.publish(options);
      }

      if (this.aborted) {
        throw new Error('Aborted');
      }

      this.completedOperations++;
      if (this.progressEvent(EventType.SUCCESS, `Published ${asset.id}`)) {
        return false;
      }
    } catch (e: any) {
      this.failures.push({ asset, error: e });
      this.completedOperations++;
      if (this.progressEvent(EventType.FAIL, e.message)) {
        return false;
      }
    }

    return true;
  }

  public get percentComplete() {
    if (this.totalOperations === 0) {
      return 100;
    }
    return Math.floor((this.completedOperations / this.totalOperations) * 100);
  }

  public abort(): void {
    this.aborted = true;
  }

  public get hasFailures() {
    return this.failures.length > 0;
  }

  /**
   * Publish a progress event to the listener, if present.
   *
   * Returns whether an abort is requested. Helper to get rid of repetitive code in publish().
   */
  private progressEvent(event: EventType, message: string): boolean {
    this.message = message;
    if (this.options.progressListener) {
      this.options.progressListener.onPublishEvent(event, this);
    }
    return this.aborted;
  }

  private assetHandler(asset: IManifestEntry) {
    const existing = this.handlerCache.get(asset);
    if (existing) {
      return existing;
    }
    if (this.options.quiet !== undefined && this.options.subprocessOutputDestination) {
      throw new Error(
        'Cannot set both quiet and subprocessOutputDestination. Please use only subprocessOutputDestination',
      );
    }
    const subprocessOutputDestination =
      this.options.subprocessOutputDestination ?? (this.options.quiet ? 'ignore' : 'stdio');
    const ret = makeAssetHandler(this.manifest, asset, this.handlerHost, {
      subprocessOutputDestination,
    });
    this.handlerCache.set(asset, ret);
    return ret;
  }
}
