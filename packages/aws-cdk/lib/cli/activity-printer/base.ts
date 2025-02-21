import { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { StackActivity } from '../../api/stack-events';
import { StackProgress } from '../../api/stack-events/stack-progress-monitor';
import { IoMessage } from '../../toolkit/cli-io-host';
import { maxResourceTypeLength, stackEventHasErrorMessage } from '../../util';

export interface IActivityPrinter {
  notify<T>(msg: IoMessage<T>): void;
}

export interface ActivityPrinterProps {
  /**
   * Stream to write to
   */
  readonly stream: NodeJS.WriteStream;
}

export abstract class ActivityPrinterBase implements IActivityPrinter {
  protected static readonly TIMESTAMP_WIDTH = 12;
  protected static readonly STATUS_WIDTH = 20;

  /**
   * Fetch new activity every 5 seconds
   */
  public readonly updateSleep: number = 5_000;

  /**
   * Stream to write to
   */
  protected readonly stream: NodeJS.WriteStream;

  /**
   * The with of the "resource type" column.
   */
  protected resourceTypeColumnWidth: number = maxResourceTypeLength({});

  /**
   * A list of resource IDs which are currently being processed
   */
  protected resourcesInProgress: Record<string, StackActivity> = {};

  protected stackProgress?: StackProgress;

  protected rollingBack = false;

  protected readonly failures = new Array<StackActivity>();

  protected hookFailureMap = new Map<string, Map<string, string>>();

  /**
   * Current tick timer
   */
  private tickTimer?: ReturnType<typeof setTimeout>;

  /**
   * Is the printer currently active?
   **/
  protected active: boolean = false;

  constructor(protected readonly props: ActivityPrinterProps) {
    this.stream = props.stream;
  }

  protected abstract print(): void;

  /**
   * Receive a stack activity message
   */
  public notify(msg: IoMessage<any>) {
    // start polling
    if (msg.code === 'CDK_TOOLKIT_I5501') {
      return this.start(msg.data);
    }

    // stop polling
    if (msg.code === 'CDK_TOOLKIT_I5503') {
      return this.stop();
    }

    // Ignore all other messages
    if (msg.code !== 'CDK_TOOLKIT_I5502') {
      return;
    }

    this.addActivity(msg.data as StackActivity);
  }

  protected addActivity(activity: StackActivity) {
    const status = activity.event.ResourceStatus;
    const hookStatus = activity.event.HookStatus;
    const hookType = activity.event.HookType;
    if (!status || !activity.event.LogicalResourceId) {
      return;
    }

    this.stackProgress = activity.progress;

    if (status === 'ROLLBACK_IN_PROGRESS' || status === 'UPDATE_ROLLBACK_IN_PROGRESS') {
      // Only triggered on the stack once we've started doing a rollback
      this.rollingBack = true;
    }

    if (status.endsWith('_IN_PROGRESS')) {
      this.resourcesInProgress[activity.event.LogicalResourceId] = activity;
    }

    if (stackEventHasErrorMessage(status)) {
      const isCancelled = (activity.event.ResourceStatusReason ?? '').indexOf('cancelled') > -1;

      // Cancelled is not an interesting failure reason
      if (!isCancelled) {
        this.failures.push(activity);
      }
    }

    if (status.endsWith('_COMPLETE') || status.endsWith('_FAILED')) {
      delete this.resourcesInProgress[activity.event.LogicalResourceId];
    }

    if (
      hookStatus !== undefined &&
        hookStatus.endsWith('_COMPLETE_FAILED') &&
        activity.event.LogicalResourceId !== undefined &&
        hookType !== undefined
    ) {
      if (this.hookFailureMap.has(activity.event.LogicalResourceId)) {
        this.hookFailureMap.get(activity.event.LogicalResourceId)?.set(hookType, activity.event.HookStatusReason ?? '');
      } else {
        this.hookFailureMap.set(activity.event.LogicalResourceId, new Map<string, string>());
        this.hookFailureMap.get(activity.event.LogicalResourceId)?.set(hookType, activity.event.HookStatusReason ?? '');
      }
    }
  }

  protected failureReason(activity: StackActivity) {
    const resourceStatusReason = activity.event.ResourceStatusReason ?? '';
    const logicalResourceId = activity.event.LogicalResourceId ?? '';
    const hookFailureReasonMap = this.hookFailureMap.get(logicalResourceId);

    if (hookFailureReasonMap !== undefined) {
      for (const hookType of hookFailureReasonMap.keys()) {
        if (resourceStatusReason.includes(hookType)) {
          return resourceStatusReason + ' : ' + hookFailureReasonMap.get(hookType);
        }
      }
    }
    return resourceStatusReason;
  }

  protected start({ stack }: { stack: CloudFormationStackArtifact}) {
    this.resourceTypeColumnWidth = maxResourceTypeLength(stack.template),
    this.scheduleNextTick();
  }

  protected stop() {
    this.active = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
    }
  }

  private scheduleNextTick() {
    if (!this.active) {
      return;
    }

    this.tickTimer = setTimeout(() => void this.tick(), this.updateSleep);
  }

  private async tick() {
    if (!this.active) {
      return;
    }

    this.print();

    // We might have been stop()ped while the network call was in progress.
    if (!this.active) {
      return;
    }

    this.scheduleNextTick();
  }

  /**
   * Is the activity a meta activity for the stack itself.
   */
  protected isActivityForTheStack(activity: StackActivity) {
    return activity.event.PhysicalResourceId === activity.event.StackId;
  }
}
