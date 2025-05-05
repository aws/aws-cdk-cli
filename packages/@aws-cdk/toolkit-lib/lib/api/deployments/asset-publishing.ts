import { type Environment, UNKNOWN_ACCOUNT, UNKNOWN_REGION } from '@aws-cdk/cx-api';
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
} from 'cdk-assets';
import {
  AssetPublishing,
} from 'cdk-assets';
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

const EVENT_TO_MSG_MAKER: Record<EventType, IoMessageMaker<any> | false> = {
  build: IO.DEFAULT_TOOLKIT_DEBUG,
  cached: IO.DEFAULT_TOOLKIT_DEBUG,
  check: IO.DEFAULT_TOOLKIT_DEBUG,
  debug: IO.DEFAULT_TOOLKIT_DEBUG,
  fail: IO.DEFAULT_TOOLKIT_ERROR,
  found: IO.DEFAULT_TOOLKIT_DEBUG,
  start: IO.DEFAULT_TOOLKIT_INFO,
  success: IO.DEFAULT_TOOLKIT_INFO,
  upload: IO.DEFAULT_TOOLKIT_DEBUG,
  shell_open: IO.DEFAULT_TOOLKIT_DEBUG,
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
    const maker = EVENT_TO_MSG_MAKER[type];
    if (maker) {
      void this.ioHelper.notify(maker.msg(this.getMessage(type, event)));
    }
  }
}

class PublishingProgressListener extends BasePublishProgressListener {
  protected getMessage(type: EventType, event: IPublishProgress): string {
    return `[${event.percentComplete}%] ${type}: ${event.message}`;
  }
}
