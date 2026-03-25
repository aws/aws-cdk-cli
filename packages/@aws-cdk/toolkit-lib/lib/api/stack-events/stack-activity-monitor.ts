import * as util from 'util';
import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import type { StackEvent } from '@aws-sdk/client-cloudformation';
import * as uuid from 'uuid';
import { StackEventPoller } from './stack-event-poller';
import { StackProgressMonitor } from './stack-progress-monitor';
import type { StackActivity } from '../../payloads/stack-activity';
import { isCancellationEvent, isErrorEvent, isRegularResourceEvent } from '../../util';
import type { ICloudFormationClient } from '../aws-auth/private';
import { IO, type IoHelper } from '../io/private';
import { resourceMetadata } from '../resource-metadata/resource-metadata';
import { DeploymentErrorCodes } from '../../toolkit/toolkit-error';

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

  /**
   * A list of all non-cancellation errors we have seen.
   *
   * By the nature of the order we see events in, will be ordered from oldest to newest.
   */
  private readonly _errors: StackEvent[] = [];

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

    this.progressMonitor = new StackProgressMonitor(resourcesTotal);
    this.pollingInterval = pollingInterval;
    this.poller = new StackEventPoller(cfn, {
      stackName,
      startTime: changeSetCreationTime?.getTime() ?? Date.now(),
    });
  }

  /**
   * Return error messages of all encountered errors (that aren't cancellations)
   */
  public get allErrorMessages(): string[] {
    return this._errors.map(e => e.ResourceStatusReason ?? '');
  }

  /**
   * Return error codeds of all encountered errors (that aren't cancellations nor stack errors)
   *
   * We don't need to include nested stack errors because our poller will poll the nested stack,
   * and have returned the actual error as well.
   */
  public get allErrorCodes(): string[] {
    return this._errors
      .filter(isRegularResourceEvent)
      .map(extractErrorCode);
  }

  /**
   * Take our best guess at the error code of the root cause
   *
   * The first error that occurs is the root cause.
   */
  public get rootCauseErrorCode(): string | undefined {
    return this.allErrorCodes[0];
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
   * Reads all new events from the stack history
   *
   * The events are returned in chronological order by the underlying poller.
   */
  private async readNewEvents(monitorId: string): Promise<void> {
    const pollEvents = await this.poller.poll();

    for (const resourceEvent of pollEvents) {
      this.progressMonitor.process(resourceEvent.event);

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
    if (isErrorEvent(activity.event)) {
      // Cancelled is not an interesting failure reason, nor is the stack message (stack
      // message will just say something like "stack failed to update")
      if (!isCancellationEvent(activity.event) && isRegularResourceEvent(activity.event)) {
        this._errors.push(activity.event);
      }
    }
  }
}

/**
 * Extract an error code from the given stack event.
 *
 * Always contains the services, and includes the handler error code if available.
 */
export function extractErrorCode(event: StackEvent): string {
  // Get the resource type; if it is non-AWS then we are done.
  const resourceTypeParts = (event.ResourceType ?? '').split('::');
  if (resourceTypeParts[0] !== 'AWS') {
    return DeploymentErrorCodes.PRIVATE_RESOURCE_ERROR;
  }

  const resourceType = resourceTypeParts.slice(1).join('');

  const reason = event.ResourceStatusReason ?? '';

  const errorRe = /(?:HandlerErrorCode:|Error Code:) ([a-zA-Z0-9:-]+)/;
  const handlerCode = reason.match(errorRe);

  return `${resourceType}:${handlerCode ? handlerCode[1] : DeploymentErrorCodes.UNKNOWN_ERROR}`;
}