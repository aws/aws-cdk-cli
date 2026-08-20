import type { ParameterDeclaration } from '@aws-sdk/client-cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { ICloudFormationClient } from '../aws-auth/private';
import type { IoHelper } from '../io/private';

/**
 * A multi-pattern substring search index (Aho-Corasick).
 *
 * Finds every pattern (from a fixed set) that occurs anywhere in a text, in a
 * single pass over that text -- O(text.length + sum(pattern.length)) total,
 * regardless of how many patterns are being searched for. This is what makes
 * `ActiveAssetCache.containsAny()` scale: checking N asset hashes against M
 * stack templates costs O(M templates scanned once + N pattern lengths), not
 * O(N asset hashes x M stacks x template size).
 */
class AhoCorasickIndex {
  private readonly children: Array<Map<string, number>> = [new Map()];
  private readonly fail: number[] = [0];
  // Pattern indices whose match ends at this node, INCLUDING those inherited
  // via the fail-link chain -- so a single lookup at match time is enough.
  private readonly output: Array<number[]> = [[]];

  constructor(private readonly patterns: string[]) {
    patterns.forEach((pattern, id) => this.insert(pattern, id));
    this.buildFailureLinks();
  }

  private insert(pattern: string, id: number) {
    let node = 0;
    for (const ch of pattern) {
      let next = this.children[node].get(ch);
      if (next === undefined) {
        next = this.children.length;
        this.children.push(new Map());
        this.fail.push(0);
        this.output.push([]);
        this.children[node].set(ch, next);
      }
      node = next;
    }
    if (pattern.length > 0) {
      this.output[node].push(id);
    }
  }

  private buildFailureLinks() {
    const queue: number[] = [];
    for (const child of this.children[0].values()) {
      this.fail[child] = 0;
      queue.push(child);
    }

    let head = 0;
    while (head < queue.length) {
      const node = queue[head++];
      for (const [ch, child] of this.children[node]) {
        queue.push(child);

        let f = this.fail[node];
        while (f !== 0 && !this.children[f].has(ch)) {
          f = this.fail[f];
        }
        const candidate = this.children[f].get(ch);
        this.fail[child] = candidate !== undefined && candidate !== child ? candidate : 0;

        if (this.output[this.fail[child]].length > 0) {
          this.output[child] = this.output[child].concat(this.output[this.fail[child]]);
        }
      }
    }
  }

  /**
   * Scans `text` once and adds the (pattern, not id) of every pattern found to `into`.
   */
  public search(text: string, into: Set<string>) {
    let node = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      while (node !== 0 && !this.children[node].has(ch)) {
        node = this.fail[node];
      }
      node = this.children[node].get(ch) ?? 0;

      for (const id of this.output[node]) {
        into.add(this.patterns[id]);
      }
    }
  }
}

export class ActiveAssetCache {
  private readonly stacks: string[] = [];

  public rememberStack(stackTemplate: string) {
    this.stacks.push(stackTemplate);
  }

  /**
   * Whether `asset` occurs anywhere in any remembered stack template.
   */
  public contains(asset: string): boolean {
    return this.containsAny([asset]).has(asset);
  }

  /**
   * For a batch of candidate asset identifiers, returns the subset that occur
   * anywhere in any remembered stack template. Scans every stack template exactly
   * once no matter how many candidates are passed in -- callers that need to check
   * many assets (as `cdk gc` does, in batches of up to 1000) should always prefer
   * this over calling `contains()` in a loop.
   */
  public containsAny(assets: string[]): Set<string> {
    const found = new Set<string>();
    if (assets.length === 0) {
      return found;
    }

    const uniqueAssetCount = new Set(assets).size;
    const index = new AhoCorasickIndex(assets);
    for (const stack of this.stacks) {
      if (found.size === uniqueAssetCount) {
        break;
      }
      index.search(stack, found);
    }
    return found;
  }
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
 * Fetches all relevant stack templates from CloudFormation. It ignores the following stacks:
 * - stacks in DELETE_COMPLETE or DELETE_IN_PROGRESS stage
 * - stacks that are using a different bootstrap qualifier
 */
async function fetchAllStackTemplates(cfn: ICloudFormationClient, ioHelper: IoHelper, qualifier?: string) {
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
  for (const stack of stackNames) {
    let summary;
    summary = await cfn.getTemplateSummary({
      StackName: stack,
    });

    if (bootstrapFilter(summary.Parameters, qualifier)) {
      // This stack is definitely bootstrapped to a different qualifier so we can safely ignore it
      continue;
    } else {
      const template = await cfn.getTemplate({
        StackName: stack,
      });

      templates.push((template.TemplateBody ?? '') + JSON.stringify(summary?.Parameters));
    }
  }

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
}

export async function refreshStacks(props: RefreshStacksProps) {
  try {
    const stacks = await fetchAllStackTemplates(props.cfn, props.ioHelper, props.qualifier);
    for (const stack of stacks) {
      props.activeAssets.rememberStack(stack);
    }
  } catch (err) {
    throw new ToolkitError('StackRefreshFailed', `Error refreshing stacks: ${err}`);
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
}

/**
 * Class that controls scheduling of the background stack refresh
 */
export class BackgroundStackRefresh {
  private timeout?: NodeJS.Timeout;
  private lastRefreshTime: number;
  private queuedPromises: Array<(value: unknown) => void> = [];
  private stopped = false;

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
    });
    this.justRefreshedStacks();

    // If stop() was called while the awaited refreshStacks() above was in flight, do not
    // reinstall a timer — clearTimeout() in stop() could not cancel the already-executing
    // refresh() call, and scheduling a new one here would pin the event loop forever.
    if (this.stopped) {
      return;
    }

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
      new Promise((_, reject) => setTimeout(() => reject(new ToolkitError('StackRefreshTimeout', 'refreshStacks took too long; the background thread likely threw an error')), ms)),
    ]);
  }

  public stop() {
    this.stopped = true;
    clearTimeout(this.timeout);
  }
}
