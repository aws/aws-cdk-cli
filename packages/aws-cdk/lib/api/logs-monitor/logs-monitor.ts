import * as util from 'util';
import type * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import * as uuid from 'uuid';
import type { IoHelper } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/io/private';
import { IO } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/io/private';
import type { CloudWatchLogEvent } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/payloads';
import { flatten } from '../../util';
import type { SDK } from '../aws-auth';

/**
 * Configuration tracking information on the log groups that are
 * being monitored
 */
interface LogGroupsAccessSettings {
  /**
   * The SDK for a given environment (account/region)
   */
  readonly sdk: SDK;

  /**
   * A map of log groups and associated startTime in a given account.
   *
   * The monitor will read events from the log group starting at the
   * associated startTime
   */
  readonly logGroupsStartTimes: { [logGroupName: string]: number };
}

export interface CloudWatchLogEventMonitorProps {
  /**
   * The IoHost used for messaging
   */
  readonly ioHelper: IoHelper;

  /**
   * The time from which we start reading log messages
   *
   * @default - now
   */
  readonly startTime?: Date;
}

export class CloudWatchLogEventMonitor {
  /**
   * Determines which events not to display
   */
  private startTime: number;

  /**
   * Map of environment (account:region) to LogGroupsAccessSettings
   */
  private readonly envsLogGroupsAccessSettings = new Map<string, LogGroupsAccessSettings>();

  /**
   * After reading events from all CloudWatch log groups
   * how long should we wait to read more events.
   *
   * If there is some error with reading events (i.e. Throttle)
   * then this is also how long we wait until we try again
   */
  private readonly pollingInterval: number = 2_000;

  public monitorId?: string;
  private readonly ioHelper: IoHelper;

  constructor(props: CloudWatchLogEventMonitorProps) {
    this.startTime = props.startTime?.getTime() ?? Date.now();
    this.ioHelper = props.ioHelper;
  }

  /**
   * resume reading/printing events
   */
  public async activate(): Promise<void> {
    this.monitorId = uuid.v4();

    await this.ioHelper.notify(IO.CDK_TOOLKIT_I5032.msg('Start monitoring log groups', {
      monitor: this.monitorId,
      logGroupNames: this.logGroupNames(),
    }));

    await this.tick();
    this.scheduleNextTick();
  }

  /**
   * deactivates the monitor so no new events are read
   * use case for this is when we are in the middle of performing a deployment
   * and don't want to interweave all the logs together with the CFN
   * deployment logs
   *
   * Also resets the start time to be when the new deployment was triggered
   * and clears the list of tracked log groups
   */
  public async deactivate(): Promise<void> {
    const oldMonitorId = this.monitorId!;
    this.monitorId = undefined;
    this.startTime = Date.now();

    await this.ioHelper.notify(IO.CDK_TOOLKIT_I5034.msg('Stopped monitoring log groups', {
      monitor: oldMonitorId,
      logGroupNames: this.logGroupNames(),
    }));

    this.envsLogGroupsAccessSettings.clear();
  }

  /**
   * Adds CloudWatch log groups to read log events from.
   * Since we could be watching multiple stacks that deploy to
   * multiple environments (account+region), we need to store a list of log groups
   * per env along with the SDK object that has access to read from
   * that environment.
   */
  public addLogGroups(env: cxapi.Environment, sdk: SDK, logGroupNames: string[]): void {
    const awsEnv = `${env.account}:${env.region}`;
    const logGroupsStartTimes = logGroupNames.reduce(
      (acc, groupName) => {
        acc[groupName] = this.startTime;
        return acc;
      },
      {} as { [logGroupName: string]: number },
    );
    this.envsLogGroupsAccessSettings.set(awsEnv, {
      sdk,
      logGroupsStartTimes: {
        ...this.envsLogGroupsAccessSettings.get(awsEnv)?.logGroupsStartTimes,
        ...logGroupsStartTimes,
      },
    });
  }

  private logGroupNames(): string[] {
    return Array.from(this.envsLogGroupsAccessSettings.values()).flatMap((settings) => Object.keys(settings.logGroupsStartTimes));
  }

  private scheduleNextTick(): void {
    if (!this.monitorId) {
      return;
    }

    setTimeout(() => void this.tick(), this.pollingInterval);
  }

  private async tick(): Promise<void> {
    // excluding from codecoverage because this
    // doesn't always run (depends on timing)
    /* c8 ignore start */
    if (!this.monitorId) {
      return;
    }
    /* c8 ignore stop */

    try {
      const events = flatten(await this.readNewEvents());
      for (const event of events) {
        await this.print(event);
      }

      // We might have been stop()ped while the network call was in progress.
      if (!this.monitorId) {
        return;
      }
    } catch (e: any) {
      await this.ioHelper.notify(IO.CDK_TOOLKIT_E5035.msg('Error occurred while monitoring logs: %s', { error: e }));
    }

    this.scheduleNextTick();
  }

  /**
   * Reads all new log events from a set of CloudWatch Log Groups
   * in parallel
   */
  private async readNewEvents(): Promise<Array<Array<CloudWatchLogEvent>>> {
    const promises: Array<Promise<Array<CloudWatchLogEvent>>> = [];
    for (const settings of this.envsLogGroupsAccessSettings.values()) {
      for (const group of Object.keys(settings.logGroupsStartTimes)) {
        promises.push(this.readEventsFromLogGroup(settings, group));
      }
    }
    // Limited set of log groups
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    return Promise.all(promises);
  }

  /**
   * Print out a cloudwatch event
   */
  private async print(event: CloudWatchLogEvent): Promise<void> {
    await this.ioHelper.notify(IO.CDK_TOOLKIT_I5033.msg(
      util.format(
        '[%s] %s %s',
        chalk.blue(event.logGroupName),
        chalk.yellow(event.timestamp.toLocaleTimeString()),
        event.message.trim(),
      ),
      event,
    ));
  }

  /**
   * Reads all new log events from a CloudWatch Log Group
   * starting at either the time the hotswap was triggered or
   * when the last event was read on the previous tick
   */
  private async readEventsFromLogGroup(
    logGroupsAccessSettings: LogGroupsAccessSettings,
    logGroupName: string,
  ): Promise<Array<CloudWatchLogEvent>> {
    const events: CloudWatchLogEvent[] = [];

    // log events from some service are ingested faster than others
    // so we need to track the start/end time for each log group individually
    // to make sure that we process all events from each log group
    const startTime = logGroupsAccessSettings.logGroupsStartTimes[logGroupName] ?? this.startTime;
    let endTime = startTime;
    try {
      const response = await logGroupsAccessSettings.sdk.cloudWatchLogs().filterLogEvents({
        logGroupName: logGroupName,
        limit: 100,
        startTime: startTime,
      });
      const filteredEvents = response.events ?? [];

      for (const event of filteredEvents) {
        if (event.message) {
          events.push({
            message: event.message,
            logGroupName,
            timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
          });

          if (event.timestamp && endTime < event.timestamp) {
            endTime = event.timestamp;
          }
        }
      }
      // As long as there are _any_ events in the log group `filterLogEvents` will return a nextToken.
      // This is true even if these events are before `startTime`. So if we have 100 events and a nextToken
      // then assume that we have hit the limit and let the user know some messages have been suppressed.
      // We are essentially showing them a sampling (10000 events printed out is not very useful)
      if (filteredEvents.length === 100 && response.nextToken) {
        events.push({
          message: '>>> `watch` shows only the first 100 log messages - the rest have been truncated...',
          logGroupName,
          timestamp: new Date(endTime),
        });
      }
    } catch (e: any) {
      // with Lambda functions the CloudWatch is not created
      // until something is logged, so just keep polling until
      // there is somthing to find
      if (e.name === 'ResourceNotFoundException') {
        return [];
      }
      throw e;
    }
    logGroupsAccessSettings.logGroupsStartTimes[logGroupName] = endTime + 1;
    return events;
  }
}
