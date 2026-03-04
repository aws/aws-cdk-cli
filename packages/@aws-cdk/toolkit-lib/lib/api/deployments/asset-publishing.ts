import type {
  ClientOptions,
  EventType,
  Account,
  AssetManifest,
  IAws,
  IECRClient,
  IPublishProgress,
  IPublishProgressListener,
  IS3Client,
  ISecretsManagerClient,
} from '@aws-cdk/cdk-assets-lib';
import {
  AssetPublishing,
} from '@aws-cdk/cdk-assets-lib';
import { type Environment, UNKNOWN_ACCOUNT, UNKNOWN_REGION } from '@aws-cdk/cloud-assembly-api';
import type { PublishAssetEvent } from '../../payloads/deploy';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { SDK, SdkProvider } from '../aws-auth/private';
import type { IoMessageMaker, IoHelper } from '../io/private';
import { IO } from '../io/private';
import { Mode } from '../plugin';

interface PublishAssetsOptions {
  /**
   * Whether to build/publish assets in parallel
   *
   * @default true To remain backward compatible.
   */
  readonly parallel?: boolean;

  /**
   * Whether cdk-assets is allowed to do cross account publishing.
   */
  readonly allowCrossAccount: boolean;
}

/**
 * Use cdk-assets to publish all assets in the given manifest.
 *
 * @deprecated used in legacy deployments only, should be migrated at some point
 */
export async function publishAssets(
  manifest: AssetManifest,
  sdk: SdkProvider,
  targetEnv: Environment,
  options: PublishAssetsOptions,
  ioHelper: IoHelper,
) {
  // This shouldn't really happen (it's a programming error), but we don't have
  // the types here to guide us. Do an runtime validation to be super super sure.
  if (
    targetEnv.account === undefined ||
    targetEnv.account === UNKNOWN_ACCOUNT ||
    targetEnv.region === undefined ||
    targetEnv.account === UNKNOWN_REGION
  ) {
    throw new ToolkitError(`Asset publishing requires resolved account and region, got ${JSON.stringify(targetEnv)}`);
  }

  const publisher = new AssetPublishing(manifest, {
    aws: new PublishingAws(sdk, targetEnv),
    progressListener: new PublishingProgressListener(ioHelper),
    throwOnError: false,
    publishInParallel: options.parallel ?? true,
    buildAssets: true,
    publishAssets: true,
    quiet: false,
  });
  await publisher.publish({ allowCrossAccount: options.allowCrossAccount });
  if (publisher.hasFailures) {
    throw new ToolkitError('Failed to publish one or more assets. See the error messages above for more information.');
  }
}

export class PublishingAws implements IAws {
  private sdkCache: Map<String, SDK> = new Map();

  constructor(
    /**
     * The base SDK to work with
     */
    private readonly aws: SdkProvider,

    /**
     * Environment where the stack we're deploying is going
     */
    private readonly targetEnv: Environment,
  ) {
  }

  public async discoverPartition(): Promise<string> {
    return (await this.aws.baseCredentialsPartition(this.targetEnv, Mode.ForWriting)) ?? 'aws';
  }

  public async discoverDefaultRegion(): Promise<string> {
    return this.targetEnv.region;
  }

  public async discoverCurrentAccount(): Promise<Account> {
    const account = await this.aws.defaultAccount();
    return (
      account ?? {
        accountId: '<unknown account>',
        partition: 'aws',
      }
    );
  }

  public async discoverTargetAccount(options: ClientOptions): Promise<Account> {
    return (await this.sdk(options)).currentAccount();
  }

  public async s3Client(options: ClientOptions): Promise<IS3Client> {
    return (await this.sdk(options)).s3();
  }

  public async ecrClient(options: ClientOptions): Promise<IECRClient> {
    return (await this.sdk(options)).ecr();
  }

  public async secretsManagerClient(options: ClientOptions): Promise<ISecretsManagerClient> {
    return (await this.sdk(options)).secretsManager();
  }

  /**
   * Get an SDK appropriate for the given client options
   */
  private async sdk(options: ClientOptions): Promise<SDK> {
    const env = {
      ...this.targetEnv,
      region: options.region ?? this.targetEnv.region, // Default: same region as the stack
    };

    const cacheKeyMap: any = {
      env, // region, name, account
      assumeRuleArn: options.assumeRoleArn,
      assumeRoleExternalId: options.assumeRoleExternalId,
      quiet: options.quiet,
    };

    if (options.assumeRoleAdditionalOptions) {
      cacheKeyMap.assumeRoleAdditionalOptions = options.assumeRoleAdditionalOptions;
    }

    const cacheKey = JSON.stringify(cacheKeyMap);

    const maybeSdk = this.sdkCache.get(cacheKey);
    if (maybeSdk) {
      return maybeSdk;
    }

    const sdk = (
      await this.aws.forEnvironment(
        env,
        Mode.ForWriting,
        {
          assumeRoleArn: options.assumeRoleArn,
          assumeRoleExternalId: options.assumeRoleExternalId,
          assumeRoleAdditionalOptions: options.assumeRoleAdditionalOptions,
        },
        options.quiet,
      )
    ).sdk;
    this.sdkCache.set(cacheKey, sdk);

    return sdk;
  }
}

const EVENT_TO_MSG_MAKER: Record<EventType, IoMessageMaker<PublishAssetEvent> | false> = {
  // tracked events
  start: IO.CDK_ASSETS_I5270,
  success: IO.CDK_ASSETS_I5275,
  fail: IO.CDK_ASSETS_E5279,

  // debug events
  build: IO.CDK_ASSETS_I5271,
  cached: IO.CDK_ASSETS_I5271,
  check: IO.CDK_ASSETS_I5271,
  debug: IO.CDK_ASSETS_I5271,
  found: IO.CDK_ASSETS_I5271,
  upload: IO.CDK_ASSETS_I5271,
  shell_open: IO.CDK_ASSETS_I5271,

  // dropped events
  shell_stderr: false,
  shell_stdout: false,
  shell_close: false,
};

export abstract class BasePublishProgressListener implements IPublishProgressListener {
  protected readonly ioHelper: IoHelper;

  constructor(ioHelper: IoHelper) {
    this.ioHelper = ioHelper;
  }

  protected abstract getMessage(type: EventType, event: IPublishProgress): string;

  public onPublishEvent(type: EventType, event: IPublishProgress): void {
    const io = EVENT_TO_MSG_MAKER[type];
    if (io) {
      const message = this.getMessage(type, event);
      void this.ioHelper.notify(io.msg(message, {
        type,
        message,
        progressPercentage: event.percentComplete,
        asset: event.currentAsset,
      }));
    }
  }
}

class PublishingProgressListener extends BasePublishProgressListener {
  protected getMessage(type: EventType, event: IPublishProgress): string {
    return `[${event.percentComplete}%] ${type}: ${event.message}`;
  }
}
