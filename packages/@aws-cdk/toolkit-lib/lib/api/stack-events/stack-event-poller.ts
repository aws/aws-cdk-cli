import type { StackEvent } from '@aws-sdk/client-cloudformation';
import type { ResourceError } from './resource-errors';
import { ResourceErrors } from './resource-errors';
import { formatErrorMessage, isRootStackEvent } from '../../util';
import type { ICloudFormationClient } from '../aws-auth/private';

export interface StackEventPollerProps {
  /**
   * The stack to poll
   */
  readonly stackName: string;

  /**
   * IDs of parent stacks of this resource, in case of resources in nested stacks
   */
  readonly parentStackLogicalIds?: string[];

  /**
   * A configurable algorithm to indicate when we should stop consuming the event stream.
   *
   * The "oldest event" algorithm will be called on the first occurence of
   * polling. It will be shown all events in a chunk in turn, newest-to-oldest,
   * and should decide the oldest event we're still interested in.
   *
   * On subsequent polls, we will use the events we've already seen to decide when to stop
   * polling.
   */
  readonly oldestEvent: IOldestEvent;
}

export interface IOldestEvent {
  /**
   * Whether polling should stop on seeing this event
   */
  shouldStop(event: ResourceEvent): 'stop-include' | 'stop-exclude' | 'continue';
}

export abstract class OldestEvent {
  /**
   * Stop when events are older than a given time
   */
  public static timestamp(startTime: number): IOldestEvent {
    return {
      shouldStop(event) {
        return event.event.Timestamp!.valueOf() < startTime ? 'stop-exclude' : 'continue';
      },
    };
  }

  /**
   * Stop when we see the root stack entering this status
   *
   * Should be something like `CREATE_IN_PROGRESS`, `UPDATE_IN_PROGRESS`,
   * `DELETE_IN_PROGRESS, `ROLLBACK_IN_PROGRESS`.
   */
  public static stackStatus(statuses: string[]): IOldestEvent {
    return {
      shouldStop(event) {
        return event.isRootStackEvent && statuses.includes(event.event.ResourceStatus ?? '') ? 'stop-include' : 'continue';
      },
    };
  }

  /**
   * Stop when we see events that belong to a different operation
   *
   * Records the first OperationId, and stops as soon as we see events that don't have it anymore.
   */
  public static mostRecentOperation(): IOldestEvent {
    let operationId: string | undefined;
    return {
      shouldStop(event) {
        if (operationId === undefined) {
          operationId = event.event.OperationId;
          return 'continue';
        }

        return event.event.OperationId === operationId ? 'continue' : 'stop-exclude';
      },
    };
  }

  /**
   * An "oldest event" decider that always returns 'continue'
   */
  public static consumeAll(): IOldestEvent {
    return {
      shouldStop() {
        return 'continue';
      },
    };
  }
}

export interface ResourceEvent {
  /**
   * The Stack Event as received from CloudFormation
   */
  readonly event: StackEvent;

  /**
   * IDs of parent stacks of the resource, in case of resources in nested stacks
   */
  readonly parentStackLogicalIds: string[];

  /**
   * Whether this event regards the root stack
   *
   * @default false
   */
  readonly isRootStackEvent?: boolean;
}

/**
 * Poll for stack events, potentially multiple times as new events come in over time
 *
 * Includes events from nested stacks.
 *
 * Polling may happen in multiple bursts, and every burst consumes events from newest-to-oldest
 * from the stack events API, so events are consumed in the following order:
 *
 * ```
 * CONSUMING
 *
 * stack events   (new) z y x w v u t s r q p o n m l k j i h g f e d c b a (old)
 * bursts                                          [   poll() #1    ]
 *                                   [  poll() #2   ]               ^
 *                     [  poll() #3   ]                        oldestEvent
 *                                                          decides to stop here
 * ```
 *
 * Events are sorted old-to-new before being returned, so the events returned by each
 * poll are:
 *
 * ```
 * poll() #1 => [e f g h i j k l]
 * poll() #2 => [m n o p q r s]
 * poll() #3 => [t u v w x y z]
 * ```
 *
 */
export class StackEventPoller {
  /**
   * All events we've seen so far
   */
  public readonly events: ResourceEvent[] = [];
  public complete: boolean = false;

  /**
   * A record of the errors we've seen
   */
  public readonly errors = new ResourceErrors();

  private readonly eventIds = new Set<string>();
  private readonly nestedStackPollers: Record<string, StackEventPoller> = {};

  constructor(
    private readonly cfn: ICloudFormationClient,
    private readonly props: StackEventPollerProps,
  ) {
  }

  /**
   * From all accumulated events, return only the errors
   */
  public get resourceErrors(): ReadonlyArray<ResourceError> {
    return this.errors.all;
  }

  /**
   * Poll for new stack events
   *
   * Will read all events that are available up until the oldest events
   * indicated by the constructor filters, or until it encounters events that it
   * has already read before.
   *
   * Recurses into nested stacks, and returns events old-to-new. Multiple
   * invocations to `poll` will return *newer* events (also in old-to-new order).
   */
  public async poll(): Promise<ResourceEvent[]> {
    const events: ResourceEvent[] = await this.doPoll();

    // Also poll all nested stacks we're currently tracking
    for (const [logicalId, poller] of Object.entries(this.nestedStackPollers)) {
      events.push(...(await poller.poll()));
      if (poller.complete) {
        delete this.nestedStackPollers[logicalId];
      }
    }

    // Return what we have so far
    events.sort((a, b) => a.event.Timestamp!.valueOf() - b.event.Timestamp!.valueOf());
    this.events.push(...events);

    this.errors.update(...events);

    return events;
  }

  private async doPoll(): Promise<ResourceEvent[]> {
    // If we already have events and we poll again, we can only get newer events up to
    // events we've already seen. No need to invoke the "oldestEvent" decider again.
    const stopDecider = this.eventIds.size > 0 ? OldestEvent.consumeAll() : this.props.oldestEvent;

    const events: ResourceEvent[] = [];
    try {
      let nextToken: string | undefined;
      let finished = false;

      while (!finished) {
        const page = await this.cfn.describeStackEvents({ StackName: this.props.stackName, NextToken: nextToken });
        for (const event of page?.StackEvents ?? []) {
          // Already seen this one
          if (this.eventIds.has(event.EventId!)) {
            return events;
          }

          const isParentStackEvent = isRootStackEvent(event);
          // Fresh event
          const resEvent: ResourceEvent = {
            event: event,
            parentStackLogicalIds: this.props.parentStackLogicalIds ?? [],
            isRootStackEvent: isParentStackEvent,
          };

          // Make a stop decision
          const stopDecision = stopDecider.shouldStop(resEvent);
          if (stopDecision === 'stop-exclude') {
            return events;
          }

          this.eventIds.add(event.EventId!);

          events.push(resEvent);

          if (stopDecision === 'stop-include') {
            return events;
          }

          if (
            !isParentStackEvent &&
              event.ResourceType === 'AWS::CloudFormation::Stack' &&
              isStackBeginOperationState(event.ResourceStatus)
          ) {
            // If the event is not for `this` stack and has a physical resource Id, recursively call for events in the nested stack
            this.trackNestedStack(event, [...(this.props.parentStackLogicalIds ?? []), event.LogicalResourceId ?? '']);
          }

          if (isParentStackEvent && isStackTerminalState(event.ResourceStatus)) {
            this.complete = true;
          }
        }

        nextToken = page?.NextToken;
        if (nextToken === undefined) {
          finished = true;
        }
      }
    } catch (e: any) {
      if (!(e.name === 'ValidationError' && formatErrorMessage(e) === `Stack [${this.props.stackName}] does not exist`)) {
        throw e;
      }
    }

    return events;
  }

  /**
   * On the CREATE_IN_PROGRESS, UPDATE_IN_PROGRESS, DELETE_IN_PROGRESS event of a nested stack, poll the nested stack updates
   */
  private trackNestedStack(event: StackEvent, parentStackLogicalIds: string[]) {
    const logicalId = event.LogicalResourceId;
    const physicalResourceId = event.PhysicalResourceId;

    // The CREATE_IN_PROGRESS event for a Nested Stack is emitted twice; first without a PhysicalResourceId
    // and then with. Ignore this event if we don't have that property yet.
    //
    // (At this point, I also don't trust that logicalId is always going to be there so validate that as well)
    if (!logicalId || !physicalResourceId) {
      return;
    }

    if (!this.nestedStackPollers[logicalId]) {
      this.nestedStackPollers[logicalId] = new StackEventPoller(this.cfn, {
        stackName: physicalResourceId,
        parentStackLogicalIds: parentStackLogicalIds,
        oldestEvent: OldestEvent.timestamp(event.Timestamp!.valueOf()),
      });
    }
  }
}

function isStackBeginOperationState(state: string | undefined) {
  return [
    'CREATE_IN_PROGRESS',
    'UPDATE_IN_PROGRESS',
    'DELETE_IN_PROGRESS',
    'UPDATE_ROLLBACK_IN_PROGRESS',
    'ROLLBACK_IN_PROGRESS',
  ].includes(state ?? '');
}

function isStackTerminalState(state: string | undefined) {
  return !(state ?? '').endsWith('_IN_PROGRESS');
}
