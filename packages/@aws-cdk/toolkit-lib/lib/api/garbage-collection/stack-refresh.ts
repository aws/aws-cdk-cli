import type { ParameterDeclaration } from '@aws-sdk/client-cloudformation';
import { minimatch } from 'minimatch';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { ICloudFormationClient } from '../aws-auth/private';
import type { IoHelper } from '../io/private';
import { IO } from '../io/private/messages';

export class ActiveAssetCache {
  private readonly stacks: Set<string> = new Set();

  public rememberStack(stackTemplate: string) {
    this.stacks.add(stackTemplate);
  }

  public contains(asset: string): boolean {
    // To reduce computation if asset is empty
    if (asset=='') return false;

    for (const stack of this.stacks) {
      if (stack.includes(asset)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Check if a stack name matches any of the skip patterns using glob matching
 */
function shouldSkipStack(stackName: string, skipPatterns?: string[]): boolean {
  if (!skipPatterns || skipPatterns.length === 0) {
    return false;
  }

  // Extract stack name from ARN if entire path is passed
  // fetchAllStackTemplates can return either stack name or id so we handle both
  const extractedStackName = stackName.includes(':cloudformation:') && stackName.includes(':stack/')
    ? stackName.split('/')[1] || stackName
    : stackName;

  return skipPatterns.some(pattern => minimatch(extractedStackName, pattern));
}

async function paginateSdkCall(cb: (nextToken?: string) => Promise<string | undefined>) {
  let finished = false;
  let nextToken: string | undefined;
  while (!finished) {
    nextToken = await cb(nextToken);
    if (nextToken === undefined) {
      finished = true;
    }
  }
}

/**
 * Handle unauthorized stacks by asking user if they want to skip them all
 */
async function handleUnauthorizedStacks(unauthorizedStacks: string[], ioHelper: IoHelper): Promise<void> {
  if (unauthorizedStacks.length === 0) {
    return;
  }

  try {
    // Ask user if they want to proceed. Default is no
    // In CI environments, IoHelper automatically accepts the default response
    const response = await ioHelper.requestResponse(
      IO.CDK_TOOLKIT_I9211.req(`Found ${unauthorizedStacks.length} unauthorized stack(s): ${unauthorizedStacks.join(',\n')}\nDo you want to skip all these stacks? Default is 'no'`, {
        stacks: unauthorizedStacks,
        count: unauthorizedStacks.length,
        responseDescription: '[y]es/[n]o',
      }, 'n'), // To account for ci/cd environments, default remains no until a --yes flag is implemented for cdk-cli
    );

    // Throw error if user response is not yes or y
    if (!response || !['y', 'yes'].includes(response.toLowerCase())) {
      throw new ToolkitError('Operation cancelled by user due to unauthorized stacks');
    }

    await ioHelper.defaults.info(`Skipping ${unauthorizedStacks.length} unauthorized stack(s)`);
  } catch (error) {
    if (error instanceof ToolkitError) {
      throw error;
    }
    throw new ToolkitError(`Failed to handle unauthorized stacks: ${error}`);
  }
}

/**
 * Fetches all relevant stack templates from CloudFormation. It ignores the following stacks:
 * - stacks in DELETE_COMPLETE or DELETE_IN_PROGRESS stage
 * - stacks that are using a different bootstrap qualifier
 * - unauthorized stacks that match the skip patterns (when specified)
 */
async function fetchAllStackTemplates(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  qualifier?: string,
  unauthNativeCfnStacksToSkip?: string[],
) {
  const stackNames: string[] = [];
  await paginateSdkCall(async (nextToken) => {
    const stacks = await cfn.listStacks({ NextToken: nextToken });

    // We ignore stacks with these statuses because their assets are no longer live
    const ignoredStatues = ['CREATE_FAILED', 'DELETE_COMPLETE', 'DELETE_IN_PROGRESS', 'DELETE_FAILED', 'REVIEW_IN_PROGRESS'];
    stackNames.push(
      ...(stacks.StackSummaries ?? [])
        .filter((s: any) => !ignoredStatues.includes(s.StackStatus))
        .map((s: any) => s.StackId ?? s.StackName),
    );

    return stacks.NextToken;
  });

  await ioHelper.defaults.debug(`Parsing through ${stackNames.length} stacks`);

  const templates: string[] = [];
  const unauthorizedStacks: string[] = [];

  for (const stack of stackNames) {
    try {
      let summary;
      summary = await cfn.getTemplateSummary({
        StackName: stack,
      });

      if (bootstrapFilter(summary.Parameters, qualifier)) {
        // This stack is definitely bootstrapped to a different qualifier so we can safely ignore it
        continue;
      }

      const template = await cfn.getTemplate({
        StackName: stack,
      });

      templates.push((template.TemplateBody ?? '') + JSON.stringify(summary?.Parameters));
    } catch (error: any) {
      // Check if this is a CloudFormation access denied error
      if (error.name === 'AccessDenied') {
        if (shouldSkipStack(stack, unauthNativeCfnStacksToSkip)) {
          unauthorizedStacks.push(stack);
          continue;
        }

        throw new ToolkitError(
          `Access denied when trying to access stack '${stack}'. ` +
          'If this is a native CloudFormation stack that you want to skip, add it to --unauth-native-cfn-stacks-to-skip.',
        );
      }

      // Re-throw the error if it's not handled
      throw error;
    }
  }

  await handleUnauthorizedStacks(unauthorizedStacks, ioHelper);

  await ioHelper.defaults.debug('Done parsing through stacks');

  return templates;
}

/**
 * Filter out stacks that we KNOW are using a different bootstrap qualifier
 * This is mostly necessary for the integration tests that can run the same app (with the same assets)
 * under different qualifiers.
 * This is necessary because a stack under a different bootstrap could coincidentally reference the same hash
 * and cause a false negative (cause an asset to be preserved when its isolated)
 * This is intentionally done in a way where we ONLY filter out stacks that are meant for a different qualifier
 * because we are okay with false positives.
 */
function bootstrapFilter(parameters?: ParameterDeclaration[], qualifier?: string) {
  const bootstrapVersion = parameters?.find((p) => p.ParameterKey === 'BootstrapVersion');
  const splitBootstrapVersion = bootstrapVersion?.DefaultValue?.split('/');
  // We find the qualifier in a specific part of the bootstrap version parameter
  return (qualifier &&
          splitBootstrapVersion &&
          splitBootstrapVersion.length == 4 &&
          splitBootstrapVersion[2] != qualifier);
}

export interface RefreshStacksProps {
  readonly cfn: ICloudFormationClient;
  readonly ioHelper: IoHelper;
  readonly activeAssets: ActiveAssetCache;
  readonly qualifier?: string;
  readonly unauthNativeCfnStacksToSkip?: string[];
}

export async function refreshStacks(props: RefreshStacksProps) {
  try {
    const stacks = await fetchAllStackTemplates(
      props.cfn,
      props.ioHelper,
      props.qualifier,
      props.unauthNativeCfnStacksToSkip,
    );
    for (const stack of stacks) {
      props.activeAssets.rememberStack(stack);
    }
  } catch (err) {
    throw new ToolkitError(`Error refreshing stacks: ${err}`);
  }
}

/**
 * Background Stack Refresh properties
 */
export interface BackgroundStackRefreshProps {
  /**
   * The CFN SDK handler
   */
  readonly cfn: ICloudFormationClient;

  /**
   * Used to send messages.
   */
  readonly ioHelper: IoHelper;

  /**
   * Active Asset storage
   */
  readonly activeAssets: ActiveAssetCache;

  /**
   * Stack bootstrap qualifier
   */
  readonly qualifier?: string;

  /**
   * Native CloudFormation stack names or glob patterns to skip when encountering unauthorized access errors
   */
  readonly unauthNativeCfnStacksToSkip?: string[];
}

/**
 * Class that controls scheduling of the background stack refresh
 */
export class BackgroundStackRefresh {
  private timeout?: NodeJS.Timeout;
  private lastRefreshTime: number;
  private queuedPromises: Array<(value: unknown) => void> = [];

  constructor(private readonly props: BackgroundStackRefreshProps) {
    this.lastRefreshTime = Date.now();
  }

  public start() {
    // Since start is going to be called right after the first invocation of refreshStacks,
    // lets wait some time before beginning the background refresh.
    this.timeout = setTimeout(() => this.refresh(), 300_000); // 5 minutes
  }

  private async refresh() {
    const startTime = Date.now();

    await refreshStacks({
      cfn: this.props.cfn,
      ioHelper: this.props.ioHelper,
      activeAssets: this.props.activeAssets,
      qualifier: this.props.qualifier,
      unauthNativeCfnStacksToSkip: this.props.unauthNativeCfnStacksToSkip,
    });
    this.justRefreshedStacks();

    // If the last invocation of refreshStacks takes <5 minutes, the next invocation starts 5 minutes after the last one started.
    // If the last invocation of refreshStacks takes >5 minutes, the next invocation starts immediately.
    this.timeout = setTimeout(() => this.refresh(), Math.max(startTime + 300_000 - Date.now(), 0));
  }

  private justRefreshedStacks() {
    this.lastRefreshTime = Date.now();
    for (const p of this.queuedPromises.splice(0, this.queuedPromises.length)) {
      p(undefined);
    }
  }

  /**
   * Checks if the last successful background refresh happened within the specified time frame.
   * If the last refresh is older than the specified time frame, it returns a Promise that resolves
   * when the next background refresh completes or rejects if the refresh takes too long.
   */
  public noOlderThan(ms: number) {
    const horizon = Date.now() - ms;

    // The last refresh happened within the time frame
    if (this.lastRefreshTime >= horizon) {
      return Promise.resolve();
    }

    // The last refresh happened earlier than the time frame
    // We will wait for the latest refresh to land or reject if it takes too long
    return Promise.race([
      new Promise(resolve => this.queuedPromises.push(resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new ToolkitError('refreshStacks took too long; the background thread likely threw an error')), ms)),
    ]);
  }

  public stop() {
    clearTimeout(this.timeout);
  }
}
