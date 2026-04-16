import * as util from 'util';
import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import * as uuid from 'uuid';
import { StackEventPoller, OldestEvent } from './stack-event-poller';
import { StackProgressMonitor } from './stack-progress-monitor';
import type { StackActivity } from '../../payloads/stack-activity';
import type { ICloudFormationClient } from '../aws-auth/private';
import type { EnvironmentResources } from '../environment';
import { IO, type IoHelper } from '../io/private';
import { resourceMetadata } from '../resource-metadata/resource-metadata';

export interface StackActivityMonitorProps {
  /**
   * The CloudFormation client
   */
  readonly cfn: ICloudFormationClient;

  /**
   * The IoHelper used for messaging
   */
  readonly ioHelper: IoHelper;

  /**
   * The stack artifact that is getting deployed
   */
  readonly stack: CloudFormationStackArtifact;

  /**
   * The name of the Stack that is getting deployed
   */
  readonly stackName: string;

  /**
   * Total number of resources to update
   *
   * Used to calculate a progress bar.
   *
   * @default - No progress reporting
   */
  readonly resourcesTotal?: number;

  /**
   * Creation time of the change set
   *
   * This will be used to filter events, only showing those from after the change
   * set creation time.
   *
   * It is recommended to use this, otherwise the filtering will be subject
   * to clock drift between local and cloud machines.
   *
   * @default - Local machine's current time
   */
  readonly changeSetCreationTime?: Date;

  /**
   * Time to wait between fetching new activities.
   *
   * Must wait a reasonable amount of time between polls, since we need to consider CloudFormation API limits
   *
   * @default 2_000
   */
  readonly pollingInterval?: number;

  /**
   * Environment resources, used to look up the bootstrap toolkit version when
   * diagnosing Guard Hook annotation fetch failures.
   *
   * @default - Bootstrap version is not reported in error messages
   */
  readonly envResources?: EnvironmentResources;
}

/**
 * Drives the monitoring of a Stack deployment
 *
 * ```
 * ┌───────────────────────┐        ┌───────────────────────┐              ┌───────────────────────┐
 * │         Stack         │ poll() │         Stack         │  process(ev) │         Stack         │
 * │      EventPoller      │◀───────│    ActivityMonitor    │─────────────▶│    ProgressMonitor    │
 * └───────────────────────┘        └───────────────────────┘              └───────────────────────┘
 * ```
 */
export class StackActivityMonitor {
  /**
   * The poller used to read stack events
   */
  private readonly poller: StackEventPoller;

  /**
   * Fetch new activity every 1 second
   * Printers can decide to update a view less frequently if desired
   */
  private readonly pollingInterval: number;

  private monitorId?: string;

  private readonly progressMonitor: StackProgressMonitor;

  /**
   * Current tick timer
   */
  private tickTimer?: ReturnType<typeof setTimeout>;

  /**
   * Set to the activity of reading the current events
   */
  private readPromise?: Promise<any>;

  private readonly ioHelper: IoHelper;
  private readonly stackName: string;
  private readonly stack: CloudFormationStackArtifact;
  private readonly cfn: ICloudFormationClient;
  private readonly envResources?: EnvironmentResources;

  constructor({
    cfn,
    ioHelper,
    stack,
    stackName,
    resourcesTotal,
    changeSetCreationTime,
    pollingInterval = 2_000,
    envResources,
  }: StackActivityMonitorProps) {
    this.ioHelper = ioHelper;
    this.stack = stack;
    this.stackName = stackName;
    this.cfn = cfn;
    this.envResources = envResources;

    this.progressMonitor = new StackProgressMonitor(resourcesTotal);
    this.pollingInterval = pollingInterval;
    this.poller = new StackEventPoller(cfn, {
      stackName,
      oldestEvent: OldestEvent.timestamp(changeSetCreationTime?.getTime() ?? Date.now()),
    });
  }

  /**
   * The resource errors that were discovered during monitoring of this stack
   */
  public get errors() {
    return this.poller.errors;
  }

  public async start() {
    this.monitorId = uuid.v4();
    await this.ioHelper.notify(IO.CDK_TOOLKIT_I5501.msg(`Deploying ${this.stackName}`, {
      deployment: this.monitorId,
      stack: this.stack,
      stackName: this.stackName,
      resourcesTotal: this.progressMonitor.total,
    }));
    this.scheduleNextTick();
    return this;
  }

  public async stop() {
    const oldMonitorId = this.monitorId!;
    this.monitorId = undefined;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
    }

    // Do a final poll for all events. This is to handle the situation where DescribeStackStatus
    // already returned an error, but the monitor hasn't seen all the events yet and we'd end
    // up not printing the failure reason to users.
    await this.finalPollToEnd(oldMonitorId);

    await this.ioHelper.notify(IO.CDK_TOOLKIT_I5503.msg(`Completed ${this.stackName}`, {
      deployment: oldMonitorId,
      stack: this.stack,
      stackName: this.stackName,
      resourcesTotal: this.progressMonitor.total,
    }));
  }

  private scheduleNextTick() {
    if (!this.monitorId) {
      return;
    }

    this.tickTimer = setTimeout(() => void this.tick(), this.pollingInterval);
  }

  private async tick() {
    if (!this.monitorId) {
      return;
    }

    try {
      this.readPromise = this.readNewEvents(this.monitorId);
      await this.readPromise;
      this.readPromise = undefined;

      // We might have been stop()ped while the network call was in progress.
      if (!this.monitorId) {
        return;
      }
    } catch (e) {
      await this.ioHelper.notify(IO.CDK_TOOLKIT_E5500.msg(
        util.format('Error occurred while monitoring stack: %s', e),
        { error: e as any },
      ));
    }
    this.scheduleNextTick();
  }

  private findMetadataFor(logicalId: string | undefined) {
    const metadata = this.stack.metadata;
    if (!logicalId || !metadata) {
      return undefined;
    }
    return resourceMetadata(this.stack, logicalId);
  }

  /**
   * Trims leading/trailing whitespace, collapses all internal whitespace
   * (including newlines) to a single space, and truncates to `maxChars`
   * characters, appending `[...truncated]` when the original was longer.
   */
  private normalizeMessage(message: string, maxChars: number = 400): string {
    const normalized = message.trim().replace(/\s+/g, ' ');
    return normalized.length > maxChars
      ? normalized.substring(0, maxChars) + '[...truncated]'
      : normalized;
  }

  /**
   * Fetches Guard Hook annotation details via GetHookResult API and formats them
   * into a human-readable string. Returns undefined if the fetch fails or there
   * are no failed annotations.
   */
  private async fetchGuardHookAnnotations(hookInvocationId: string): Promise<string | undefined> {
    try {
      const result = await this.cfn.getHookResult({ HookResultId: hookInvocationId });
      const annotations = result.Annotations ?? [];
      const failedAnnotations = annotations.filter((a) => a.Status === 'FAILED');
      if (failedAnnotations.length === 0) {
        return undefined;
      }

      const lines: string[] = ['NonCompliant Rules:', ''];
      for (const annotation of failedAnnotations) {
        if (annotation.AnnotationName) {
          lines.push(`[${annotation.AnnotationName}]`);
        }
        if (annotation.StatusMessage) {
          lines.push(`• ${this.normalizeMessage(annotation.StatusMessage)}`);
        }
        if (annotation.RemediationMessage) {
          lines.push(`Remediation: ${this.normalizeMessage(annotation.RemediationMessage)}`);
        }
        lines.push('');
      }
      return lines.join('\n').trimEnd();
    } catch (e: any) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      const isPermissionsError =
        e.name === 'AccessDeniedException' ||
        (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('not authorized to perform: cloudformation:gethookresult'));

      if (isPermissionsError && this.envResources) {
        let currentVersion: number | undefined = undefined;
        try {
          currentVersion = (await this.envResources.lookupToolkit()).version;
        } catch {
          // ignore errors looking up the bootstrap version
        }

        await this.ioHelper.defaults.warn(
          util.format(
            `Failed to fetch result details for Hook invocation ${hookInvocationId}: ${errorMessage}. Make sure you have permissions to call the GetHookResult API, or re-bootstrap your environment by running 'cdk bootstrap' to update the Bootstrap CDK Toolkit stack.
            'Bootstrap toolkit stack version 31 or later is needed; current version: ${currentVersion ?? 'unknown'}.`,
          ),
        );
      } else {
        await this.ioHelper.defaults.warn(
          util.format('Failed to fetch Guard Hook details for invocation %s: %s', hookInvocationId, errorMessage),
        );
      }

      return undefined;
    }
  }

  /**
   * Reads all new events from the stack history
   *
   * The events are returned in chronological order by the underlying poller.
   */
  private async readNewEvents(monitorId: string): Promise<void> {
    const pollEvents = await this.poller.poll();

    for (const resourceEvent of pollEvents) {
      this.progressMonitor.process(resourceEvent.event);

      // If this is a failed Guard Hook event with an invocation ID, fetch annotations
      if (resourceEvent.event.HookInvocationId) {
        const annotations = await this.fetchGuardHookAnnotations(resourceEvent.event.HookInvocationId);
        if (annotations) {
          resourceEvent.event.HookStatusReason = annotations;
        }
      }

      const activity: StackActivity = {
        deployment: monitorId,
        event: resourceEvent.event,
        metadata: this.findMetadataFor(resourceEvent.event.LogicalResourceId),
        progress: this.progressMonitor.progress,
      };

      await this.ioHelper.notify(IO.CDK_TOOLKIT_I5502.msg(this.formatActivity(activity, true), activity));
    }
  }

  /**
   * Perform a final poll to the end and flush out all events to the printer
   *
   * Finish any poll currently in progress, then do a final one until we've
   * reached the last page.
   */
  private async finalPollToEnd(monitorId: string) {
    // If we were doing a poll, finish that first. It was started before
    // the moment we were sure we weren't going to get any new events anymore
    // so we need to do a new one anyway. Need to wait for this one though
    // because our state is single-threaded.
    if (this.readPromise) {
      await this.readPromise;
    }

    await this.readNewEvents(monitorId);
  }

  /**
   * Formats a stack activity into a basic string
   */
  private formatActivity(activity: StackActivity, progress: boolean): string {
    const event = activity.event;
    const metadata = activity.metadata;

    const resourceName = metadata ? metadata.constructPath : event.LogicalResourceId || '';
    const logicalId = resourceName !== event.LogicalResourceId ? `(${event.LogicalResourceId}) ` : '';

    return util.format(
      '%s | %s%s | %s | %s | %s %s%s%s',
      event.StackName,
      progress !== false ? `${activity.progress.formatted} | ` : '',
      new Date(event.Timestamp!).toLocaleTimeString(),
      event.ResourceStatus || '',
      event.ResourceType,
      resourceName,
      logicalId,
      event.ResourceStatusReason ? event.ResourceStatusReason : '',
      metadata?.entry.trace ? `\n\t${metadata.entry.trace.join('\n\t\\_ ')}` : '',
    );
  }
}

