import * as util from 'util';
import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import * as uuid from 'uuid';
import { StackEventPoller } from './stack-event-poller';
import { StackProgressMonitor } from './stack-progress-monitor';
import type { StackActivity } from '../../payloads/stack-activity';
import { stackEventHasErrorMessage } from '../../util';
import type { ICloudFormationClient } from '../aws-auth/private';
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
}

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

  public readonly errors: string[] = [];

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

  constructor({
    cfn,
    ioHelper,
    stack,
    stackName,
    resourcesTotal,
    changeSetCreationTime,
    pollingInterval = 2_000,
  }: StackActivityMonitorProps) {
    this.ioHelper = ioHelper;
    this.stack = stack;
    this.stackName = stackName;
    this.cfn = cfn;

    this.progressMonitor = new StackProgressMonitor(resourcesTotal);
    this.pollingInterval = pollingInterval;
    this.poller = new StackEventPoller(cfn, {
      stackName,
      startTime: changeSetCreationTime?.getTime() ?? Date.now(),
    });
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
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await this.ioHelper.defaults.warn(
        util.format('Failed to fetch Guard Hook details for invocation %s: %s', hookInvocationId, errorMessage),
      );
      return undefined;
    }
  }

  /**
   * Reads all new events from the stack history
   *
   * The events are returned in reverse chronological order; we continue to the next page if we
   * see a next page and the last event in the page is new to us (and within the time window).
   * haven't seen the final event
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

      this.checkForErrors(activity);
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

  private checkForErrors(activity: StackActivity) {
    if (stackEventHasErrorMessage(activity.event.ResourceStatus ?? '')) {
      const isCancelled = (activity.event.ResourceStatusReason ?? '').indexOf('cancelled') > -1;

      // Cancelled is not an interesting failure reason, nor is the stack message (stack
      // message will just say something like "stack failed to update")
      if (!isCancelled && activity.event.StackName !== activity.event.LogicalResourceId) {
        this.errors.push(activity.event.ResourceStatusReason ?? '');
      }
    }
  }
}
