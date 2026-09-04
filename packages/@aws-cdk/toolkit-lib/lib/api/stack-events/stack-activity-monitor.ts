import { randomUUID } from 'node:crypto';
import * as util from 'node:util';
import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import { fetchHookResultDetails } from './hook-result-details';
import { StackEventPoller, PollRange } from './stack-event-poller';
import { StackProgressMonitor } from './stack-progress-monitor';
import type { StackActivity } from '../../payloads/stack-activity';
import { stackNameFromArn } from '../../util/cloudformation';
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
   * The ARN of the Stack that is getting deployed
   */
  readonly stackArn: string;

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

  /**
   * Whether this deployment is an update to an existing stack (as opposed to a creation).
   *
   * @default false
   */
  readonly isStackUpdate?: boolean;
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
  private readonly stackDisplayName: string;
  private readonly stack: CloudFormationStackArtifact;
  private readonly cfn: ICloudFormationClient;
  private readonly envResources?: EnvironmentResources;
  private readonly isStackUpdate: boolean;

  constructor({
    cfn,
    ioHelper,
    stack,
    stackArn,
    resourcesTotal,
    changeSetCreationTime,
    pollingInterval = 2_000,
    envResources,
    isStackUpdate = false,
  }: StackActivityMonitorProps) {
    this.ioHelper = ioHelper;
    this.stack = stack;
    this.stackDisplayName = stackNameFromArn(stackArn);
    this.cfn = cfn;
    this.envResources = envResources;
    this.isStackUpdate = isStackUpdate;

    this.progressMonitor = new StackProgressMonitor(resourcesTotal);
    this.pollingInterval = pollingInterval;
    this.poller = new StackEventPoller(cfn, {
      stackArn,
      initialPollRange: PollRange.sinceTimestamp(changeSetCreationTime?.getTime() ?? Date.now()),
    });
  }

  /**
   * The resource errors that were discovered during monitoring of this stack
   */
  public get errors() {
    return this.poller.errors;
  }

  /**
   * Resources that received DELETE_FAILED during the stack update.
   * CloudFormation skips these and completes the update anyway.
   */
  public get deleteFailures() {
    return this.poller.deleteFailures;
  }

  /**
   * Resources that completed deployment but are still stabilizing.
   * Populated for Express Mode deployments.
   */
  public get stabilizingResources() {
    return this.poller.stabilizingResources;
  }

  public async start() {
    this.monitorId = randomUUID();
    await this.ioHelper.notify(IO.CDK_TOOLKIT_I5501.msg(`Deploying ${this.stackDisplayName}`, {
      deployment: this.monitorId,
      stack: this.stack,
      stackName: this.stackDisplayName,
      resourcesTotal: this.progressMonitor.total,
      isStackUpdate: this.isStackUpdate,
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

    await this.ioHelper.notify(IO.CDK_TOOLKIT_I5503.msg(`Completed ${this.stackDisplayName}`, {
      deployment: oldMonitorId,
      stack: this.stack,
      stackName: this.stackDisplayName,
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

      // We might have been stop()ped while the network call was in progress.
      if (!this.monitorId) {
        return;
      }
    } catch (e) {
      await this.ioHelper.notify(IO.CDK_TOOLKIT_E5500.msg(
        util.format('Error occurred while monitoring stack: %s', e),
        { error: e as any },
      ));
    } finally {
      // Clear on both paths, so `readPromise` only ever holds a read that is still in flight.
      this.readPromise = undefined;
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
   * Reads all new events from the stack history
   *
   * The events are returned in chronological order by the underlying poller.
   */
  private async readNewEvents(monitorId: string): Promise<void> {
    const pollEvents = await this.poller.poll();

    for (const resourceEvent of pollEvents) {
      this.progressMonitor.process(resourceEvent);

      // If this is a failed hook event with an invocation ID, fetch the failure details
      if (resourceEvent.event.HookInvocationId) {
        const details = await fetchHookResultDetails(this.cfn, resourceEvent.event.HookInvocationId, {
          ioHelper: this.ioHelper,
          envResources: this.envResources,
        });
        if (details) {
          resourceEvent.event.HookStatusReason = details;
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
    try {
      await this.readPromise;
    } catch {
      // A failure of the in-flight poll has already been reported by tick().
    }

    // Reading events only completes the event log shown to the user; it cannot change
    // whether the monitored operation succeeded. Warn that the log may be short instead
    // of letting the failure propagate out of stop().
    try {
      await this.readNewEvents(monitorId);
    } catch (e) {
      await this.ioHelper.notify(IO.CDK_TOOLKIT_W5500.msg(
        util.format('Error occurred during final stack event poll, event log may be incomplete: %s', e),
        { error: e as any },
      ));
    }
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

