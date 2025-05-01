"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudWatchLogEventMonitor = void 0;
const util = require("util");
const chalk = require("chalk");
const uuid = require("uuid");
const util_1 = require("../../util");
const private_1 = require("../io/private");
class CloudWatchLogEventMonitor {
    /**
     * Determines which events not to display
     */
    startTime;
    /**
     * Map of environment (account:region) to LogGroupsAccessSettings
     */
    envsLogGroupsAccessSettings = new Map();
    /**
     * After reading events from all CloudWatch log groups
     * how long should we wait to read more events.
     *
     * If there is some error with reading events (i.e. Throttle)
     * then this is also how long we wait until we try again
     */
    pollingInterval = 2_000;
    monitorId;
    ioHelper;
    constructor(props) {
        this.startTime = props.startTime?.getTime() ?? Date.now();
        this.ioHelper = props.ioHelper;
    }
    /**
     * resume reading/printing events
     */
    async activate() {
        this.monitorId = uuid.v4();
        await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_I5032.msg('Start monitoring log groups', {
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
    async deactivate() {
        const oldMonitorId = this.monitorId;
        this.monitorId = undefined;
        this.startTime = Date.now();
        await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_I5034.msg('Stopped monitoring log groups', {
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
    addLogGroups(env, sdk, logGroupNames) {
        const awsEnv = `${env.account}:${env.region}`;
        const logGroupsStartTimes = logGroupNames.reduce((acc, groupName) => {
            acc[groupName] = this.startTime;
            return acc;
        }, {});
        this.envsLogGroupsAccessSettings.set(awsEnv, {
            sdk,
            logGroupsStartTimes: {
                ...this.envsLogGroupsAccessSettings.get(awsEnv)?.logGroupsStartTimes,
                ...logGroupsStartTimes,
            },
        });
    }
    logGroupNames() {
        return Array.from(this.envsLogGroupsAccessSettings.values()).flatMap((settings) => Object.keys(settings.logGroupsStartTimes));
    }
    scheduleNextTick() {
        if (!this.monitorId) {
            return;
        }
        setTimeout(() => void this.tick(), this.pollingInterval);
    }
    async tick() {
        // excluding from codecoverage because this
        // doesn't always run (depends on timing)
        /* c8 ignore start */
        if (!this.monitorId) {
            return;
        }
        /* c8 ignore stop */
        try {
            const events = (0, util_1.flatten)(await this.readNewEvents());
            for (const event of events) {
                await this.print(event);
            }
            // We might have been stop()ped while the network call was in progress.
            if (!this.monitorId) {
                return;
            }
        }
        catch (e) {
            await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_E5035.msg('Error occurred while monitoring logs: %s', { error: e }));
        }
        this.scheduleNextTick();
    }
    /**
     * Reads all new log events from a set of CloudWatch Log Groups
     * in parallel
     */
    async readNewEvents() {
        const promises = [];
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
    async print(event) {
        await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_I5033.msg(util.format('[%s] %s %s', chalk.blue(event.logGroupName), chalk.yellow(event.timestamp.toLocaleTimeString()), event.message.trim()), event));
    }
    /**
     * Reads all new log events from a CloudWatch Log Group
     * starting at either the time the hotswap was triggered or
     * when the last event was read on the previous tick
     */
    async readEventsFromLogGroup(logGroupsAccessSettings, logGroupName) {
        const events = [];
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
        }
        catch (e) {
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
exports.CloudWatchLogEventMonitor = CloudWatchLogEventMonitor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9ncy1tb25pdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9sb2dzLW1vbml0b3IvbG9ncy1tb25pdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZCQUE2QjtBQUU3QiwrQkFBK0I7QUFDL0IsNkJBQTZCO0FBRTdCLHFDQUFxQztBQUVyQywyQ0FBbUM7QUFvQ25DLE1BQWEseUJBQXlCO0lBQ3BDOztPQUVHO0lBQ0ssU0FBUyxDQUFTO0lBRTFCOztPQUVHO0lBQ2MsMkJBQTJCLEdBQUcsSUFBSSxHQUFHLEVBQW1DLENBQUM7SUFFMUY7Ozs7OztPQU1HO0lBQ2MsZUFBZSxHQUFXLEtBQUssQ0FBQztJQUUxQyxTQUFTLENBQVU7SUFDVCxRQUFRLENBQVc7SUFFcEMsWUFBWSxLQUFxQztRQUMvQyxJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzFELElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQztJQUNqQyxDQUFDO0lBRUQ7O09BRUc7SUFDSSxLQUFLLENBQUMsUUFBUTtRQUNuQixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztRQUUzQixNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsNkJBQTZCLEVBQUU7WUFDakYsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3ZCLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYSxFQUFFO1NBQ3BDLENBQUMsQ0FBQyxDQUFDO1FBRUosTUFBTSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDbEIsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7SUFDMUIsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0ksS0FBSyxDQUFDLFVB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QUMsT0FBTyxDQUFDO2lCQUM3QixDQUFDLENBQUM7WUFDTCxDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sQ0FBTSxFQUFFLENBQUM7WUFDaEIsc0RBQXNEO1lBQ3RELHdEQUF3RDtZQUN4RCw0QkFBNEI7WUFDNUIsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLDJCQUEyQixFQUFFLENBQUM7Z0JBQzNDLE9BQU8sRUFBRSxDQUFDO1lBQ1osQ0FBQztZQUNELE1BQU0sQ0FBQyxDQUFDO1FBQ1YsQ0FBQztRQUNELHVCQUF1QixDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxHQUFHLE9BQU8sR0FBRyxDQUFDLENBQUM7UUFDeEUsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztDQUNGO0FBM05ELDhEQTJOQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHV0aWwgZnJvbSAndXRpbCc7XG5pbXBvcnQgdHlwZSAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgKiBhcyBjaGFsayBmcm9tICdjaGFsayc7XG5pbXBvcnQgKiBhcyB1dWlkIGZyb20gJ3V1aWQnO1xuaW1wb3J0IHR5cGUgeyBDbG91ZFdhdGNoTG9nRXZlbnQgfSBmcm9tICcuLi8uLi9wYXlsb2Fkcy9sb2dzLW1vbml0b3InO1xuaW1wb3J0IHsgZmxhdHRlbiB9IGZyb20gJy4uLy4uL3V0aWwnO1xuaW1wb3J0IHR5cGUgeyBTREsgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgeyBJTyB9IGZyb20gJy4uL2lvL3ByaXZhdGUnO1xuaW1wb3J0IHR5cGUgeyBJb0hlbHBlciB9IGZyb20gJy4uL2lvL3ByaXZhdGUnO1xuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gdHJhY2tpbmcgaW5mb3JtYXRpb24gb24gdGhlIGxvZyBncm91cHMgdGhhdCBhcmVcbiAqIGJlaW5nIG1vbml0b3JlZFxuICovXG5pbnRlcmZhY2UgTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3Mge1xuICAvKipcbiAgICogVGhlIFNESyBmb3IgYSBnaXZlbiBlbnZpcm9ubWVudCAoYWNjb3VudC9yZWdpb24pXG4gICAqL1xuICByZWFkb25seSBzZGs6IFNESztcblxuICAvKipcbiAgICogQSBtYXAgb2YgbG9nIGdyb3VwcyBhbmQgYXNzb2NpYXRlZCBzdGFydFRpbWUgaW4gYSBnaXZlbiBhY2NvdW50LlxuICAgKlxuICAgKiBUaGUgbW9uaXRvciB3aWxsIHJlYWQgZXZlbnRzIGZyb20gdGhlIGxvZyBncm91cCBzdGFydGluZyBhdCB0aGVcbiAgICogYXNzb2NpYXRlZCBzdGFydFRpbWVcbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3Vwc1N0YXJ0VGltZXM6IHsgW2xvZ0dyb3VwTmFtZTogc3RyaW5nXTogbnVtYmVyIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xvdWRXYXRjaExvZ0V2ZW50TW9uaXRvclByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBJb0hvc3QgdXNlZCBmb3IgbWVzc2FnaW5nXG4gICAqL1xuICByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgLyoqXG4gICAqIFRoZSB0aW1lIGZyb20gd2hpY2ggd2Ugc3RhcnQgcmVhZGluZyBsb2cgbWVzc2FnZXNcbiAgICpcbiAgICogQGRlZmF1bHQgLSBub3dcbiAgICovXG4gIHJlYWRvbmx5IHN0YXJ0VGltZT86IERhdGU7XG59XG5cbmV4cG9ydCBjbGFzcyBDbG91ZFdhdGNoTG9nRXZlbnRNb25pdG9yIHtcbiAgLyoqXG4gICAqIERldGVybWluZXMgd2hpY2ggZXZlbnRzIG5vdCB0byBkaXNwbGF5XG4gICAqL1xuICBwcml2YXRlIHN0YXJ0VGltZTogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBNYXAgb2YgZW52aXJvbm1lbnQgKGFjY291bnQ6cmVnaW9uKSB0byBMb2dHcm91cHNBY2Nlc3NTZXR0aW5nc1xuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBlbnZzTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3MgPSBuZXcgTWFwPHN0cmluZywgTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3M+KCk7XG5cbiAgLyoqXG4gICAqIEFmdGVyIHJlYWRpbmcgZXZlbnRzIGZyb20gYWxsIENsb3VkV2F0Y2ggbG9nIGdyb3Vwc1xuICAgKiBob3cgbG9uZyBzaG91bGQgd2Ugd2FpdCB0byByZWFkIG1vcmUgZXZlbnRzLlxuICAgKlxuICAgKiBJZiB0aGVyZSBpcyBzb21lIGVycm9yIHdpdGggcmVhZGluZyBldmVudHMgKGkuZS4gVGhyb3R0bGUpXG4gICAqIHRoZW4gdGhpcyBpcyBhbHNvIGhvdyBsb25nIHdlIHdhaXQgdW50aWwgd2UgdHJ5IGFnYWluXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHBvbGxpbmdJbnRlcnZhbDogbnVtYmVyID0gMl8wMDA7XG5cbiAgcHVibGljIG1vbml0b3JJZD86IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgY29uc3RydWN0b3IocHJvcHM6IENsb3VkV2F0Y2hMb2dFdmVudE1vbml0b3JQcm9wcykge1xuICAgIHRoaXMuc3RhcnRUaW1lID0gcHJvcHMuc3RhcnRUaW1lPy5nZXRUaW1lKCkgPz8gRGF0ZS5ub3coKTtcbiAgICB0aGlzLmlvSGVscGVyID0gcHJvcHMuaW9IZWxwZXI7XG4gIH1cblxuICAvKipcbiAgICogcmVzdW1lIHJlYWRpbmcvcHJpbnRpbmcgZXZlbnRzXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgYWN0aXZhdGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5tb25pdG9ySWQgPSB1dWlkLnY0KCk7XG5cbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5DREtfVE9PTEtJVF9JNTAzMi5tc2coJ1N0YXJ0IG1vbml0b3JpbmcgbG9nIGdyb3VwcycsIHtcbiAgICAgIG1vbml0b3I6IHRoaXMubW9uaXRvcklkLFxuICAgICAgbG9nR3JvdXBOYW1lczogdGhpcy5sb2dHcm91cE5hbWVzKCksXG4gICAgfSkpO1xuXG4gICAgYXdhaXQgdGhpcy50aWNrKCk7XG4gICAgdGhpcy5zY2hlZHVsZU5leHRUaWNrKCk7XG4gIH1cblxuICAvKipcbiAgICogZGVhY3RpdmF0ZXMgdGhlIG1vbml0b3Igc28gbm8gbmV3IGV2ZW50cyBhcmUgcmVhZFxuICAgKiB1c2UgY2FzZSBmb3IgdGhpcyBpcyB3aGVuIHdlIGFyZSBpbiB0aGUgbWlkZGxlIG9mIHBlcmZvcm1pbmcgYSBkZXBsb3ltZW50XG4gICAqIGFuZCBkb24ndCB3YW50IHRvIGludGVyd2VhdmUgYWxsIHRoZSBsb2dzIHRvZ2V0aGVyIHdpdGggdGhlIENGTlxuICAgKiBkZXBsb3ltZW50IGxvZ3NcbiAgICpcbiAgICogQWxzbyByZXNldHMgdGhlIHN0YXJ0IHRpbWUgdG8gYmUgd2hlbiB0aGUgbmV3IGRlcGxveW1lbnQgd2FzIHRyaWdnZXJlZFxuICAgKiBhbmQgY2xlYXJzIHRoZSBsaXN0IG9mIHRyYWNrZWQgbG9nIGdyb3Vwc1xuICAgKi9cbiAgcHVibGljIGFzeW5jIGRlYWN0aXZhdGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgb2xkTW9uaXRvcklkID0gdGhpcy5tb25pdG9ySWQhO1xuICAgIHRoaXMubW9uaXRvcklkID0gdW5kZWZpbmVkO1xuICAgIHRoaXMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkNES19UT09MS0lUX0k1MDM0Lm1zZygnU3RvcHBlZCBtb25pdG9yaW5nIGxvZyBncm91cHMnLCB7XG4gICAgICBtb25pdG9yOiBvbGRNb25pdG9ySWQsXG4gICAgICBsb2dHcm91cE5hbWVzOiB0aGlzLmxvZ0dyb3VwTmFtZXMoKSxcbiAgICB9KSk7XG5cbiAgICB0aGlzLmVudnNMb2dHcm91cHNBY2Nlc3NTZXR0aW5ncy5jbGVhcigpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgQ2xvdWRXYXRjaCBsb2cgZ3JvdXBzIHRvIHJlYWQgbG9nIGV2ZW50cyBmcm9tLlxuICAgKiBTaW5jZSB3ZSBjb3VsZCBiZSB3YXRjaGluZyBtdWx0aXBsZSBzdGFja3MgdGhhdCBkZXBsb3kgdG9cbiAgICogbXVsdGlwbGUgZW52aXJvbm1lbnRzIChhY2NvdW50K3JlZ2lvbiksIHdlIG5lZWQgdG8gc3RvcmUgYSBsaXN0IG9mIGxvZyBncm91cHNcbiAgICogcGVyIGVudiBhbG9uZyB3aXRoIHRoZSBTREsgb2JqZWN0IHRoYXQgaGFzIGFjY2VzcyB0byByZWFkIGZyb21cbiAgICogdGhhdCBlbnZpcm9ubWVudC5cbiAgICovXG4gIHB1YmxpYyBhZGRMb2dHcm91cHMoZW52OiBjeGFwaS5FbnZpcm9ubWVudCwgc2RrOiBTREssIGxvZ0dyb3VwTmFtZXM6IHN0cmluZ1tdKTogdm9pZCB7XG4gICAgY29uc3QgYXdzRW52ID0gYCR7ZW52LmFjY291bnR9OiR7ZW52LnJlZ2lvbn1gO1xuICAgIGNvbnN0IGxvZ0dyb3Vwc1N0YXJ0VGltZXMgPSBsb2dHcm91cE5hbWVzLnJlZHVjZShcbiAgICAgIChhY2MsIGdyb3VwTmFtZSkgPT4ge1xuICAgICAgICBhY2NbZ3JvdXBOYW1lXSA9IHRoaXMuc3RhcnRUaW1lO1xuICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgfSxcbiAgICAgIHt9IGFzIHsgW2xvZ0dyb3VwTmFtZTogc3RyaW5nXTogbnVtYmVyIH0sXG4gICAgKTtcbiAgICB0aGlzLmVudnNMb2dHcm91cHNBY2Nlc3NTZXR0aW5ncy5zZXQoYXdzRW52LCB7XG4gICAgICBzZGssXG4gICAgICBsb2dHcm91cHNTdGFydFRpbWVzOiB7XG4gICAgICAgIC4uLnRoaXMuZW52c0xvZ0dyb3Vwc0FjY2Vzc1NldHRpbmdzLmdldChhd3NFbnYpPy5sb2dHcm91cHNTdGFydFRpbWVzLFxuICAgICAgICAuLi5sb2dHcm91cHNTdGFydFRpbWVzLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgbG9nR3JvdXBOYW1lcygpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5lbnZzTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3MudmFsdWVzKCkpLmZsYXRNYXAoKHNldHRpbmdzKSA9PiBPYmplY3Qua2V5cyhzZXR0aW5ncy5sb2dHcm91cHNTdGFydFRpbWVzKSk7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlTmV4dFRpY2soKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLm1vbml0b3JJZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHNldFRpbWVvdXQoKCkgPT4gdm9pZCB0aGlzLnRpY2soKSwgdGhpcy5wb2xsaW5nSW50ZXJ2YWwpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB0aWNrKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIGV4Y2x1ZGluZyBmcm9tIGNvZGVjb3ZlcmFnZSBiZWNhdXNlIHRoaXNcbiAgICAvLyBkb2Vzbid0IGFsd2F5cyBydW4gKGRlcGVuZHMgb24gdGltaW5nKVxuICAgIC8qIGM4IGlnbm9yZSBzdGFydCAqL1xuICAgIGlmICghdGhpcy5tb25pdG9ySWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLyogYzggaWdub3JlIHN0b3AgKi9cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBldmVudHMgPSBmbGF0dGVuKGF3YWl0IHRoaXMucmVhZE5ld0V2ZW50cygpKTtcbiAgICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZXZlbnRzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucHJpbnQoZXZlbnQpO1xuICAgICAgfVxuXG4gICAgICAvLyBXZSBtaWdodCBoYXZlIGJlZW4gc3RvcCgpcGVkIHdoaWxlIHRoZSBuZXR3b3JrIGNhbGwgd2FzIGluIHByb2dyZXNzLlxuICAgICAgaWYgKCF0aGlzLm1vbml0b3JJZCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5DREtfVE9PTEtJVF9FNTAzNS5tc2coJ0Vycm9yIG9jY3VycmVkIHdoaWxlIG1vbml0b3JpbmcgbG9nczogJXMnLCB7IGVycm9yOiBlIH0pKTtcbiAgICB9XG5cbiAgICB0aGlzLnNjaGVkdWxlTmV4dFRpY2soKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhbGwgbmV3IGxvZyBldmVudHMgZnJvbSBhIHNldCBvZiBDbG91ZFdhdGNoIExvZyBHcm91cHNcbiAgICogaW4gcGFyYWxsZWxcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcmVhZE5ld0V2ZW50cygpOiBQcm9taXNlPEFycmF5PEFycmF5PENsb3VkV2F0Y2hMb2dFdmVudD4+PiB7XG4gICAgY29uc3QgcHJvbWlzZXM6IEFycmF5PFByb21pc2U8QXJyYXk8Q2xvdWRXYXRjaExvZ0V2ZW50Pj4+ID0gW107XG4gICAgZm9yIChjb25zdCBzZXR0aW5ncyBvZiB0aGlzLmVudnNMb2dHcm91cHNBY2Nlc3NTZXR0aW5ncy52YWx1ZXMoKSkge1xuICAgICAgZm9yIChjb25zdCBncm91cCBvZiBPYmplY3Qua2V5cyhzZXR0aW5ncy5sb2dHcm91cHNTdGFydFRpbWVzKSkge1xuICAgICAgICBwcm9taXNlcy5wdXNoKHRoaXMucmVhZEV2ZW50c0Zyb21Mb2dHcm91cChzZXR0aW5ncywgZ3JvdXApKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gTGltaXRlZCBzZXQgb2YgbG9nIGdyb3Vwc1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAY2RrbGFicy9wcm9taXNlYWxsLW5vLXVuYm91bmRlZC1wYXJhbGxlbGlzbVxuICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gIH1cblxuICAvKipcbiAgICogUHJpbnQgb3V0IGEgY2xvdWR3YXRjaCBldmVudFxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwcmludChldmVudDogQ2xvdWRXYXRjaExvZ0V2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uQ0RLX1RPT0xLSVRfSTUwMzMubXNnKFxuICAgICAgdXRpbC5mb3JtYXQoXG4gICAgICAgICdbJXNdICVzICVzJyxcbiAgICAgICAgY2hhbGsuYmx1ZShldmVudC5sb2dHcm91cE5hbWUpLFxuICAgICAgICBjaGFsay55ZWxsb3coZXZlbnQudGltZXN0YW1wLnRvTG9jYWxlVGltZVN0cmluZygpKSxcbiAgICAgICAgZXZlbnQubWVzc2FnZS50cmltKCksXG4gICAgICApLFxuICAgICAgZXZlbnQsXG4gICAgKSk7XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYWxsIG5ldyBsb2cgZXZlbnRzIGZyb20gYSBDbG91ZFdhdGNoIExvZyBHcm91cFxuICAgKiBzdGFydGluZyBhdCBlaXRoZXIgdGhlIHRpbWUgdGhlIGhvdHN3YXAgd2FzIHRyaWdnZXJlZCBvclxuICAgKiB3aGVuIHRoZSBsYXN0IGV2ZW50IHdhcyByZWFkIG9uIHRoZSBwcmV2aW91cyB0aWNrXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJlYWRFdmVudHNGcm9tTG9nR3JvdXAoXG4gICAgbG9nR3JvdXBzQWNjZXNzU2V0dGluZ3M6IExvZ0dyb3Vwc0FjY2Vzc1NldHRpbmdzLFxuICAgIGxvZ0dyb3VwTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPEFycmF5PENsb3VkV2F0Y2hMb2dFdmVudD4+IHtcbiAgICBjb25zdCBldmVudHM6IENsb3VkV2F0Y2hMb2dFdmVudFtdID0gW107XG5cbiAgICAvLyBsb2cgZXZlbnRzIGZyb20gc29tZSBzZXJ2aWNlIGFyZSBpbmdlc3RlZCBmYXN0ZXIgdGhhbiBvdGhlcnNcbiAgICAvLyBzbyB3ZSBuZWVkIHRvIHRyYWNrIHRoZSBzdGFydC9lbmQgdGltZSBmb3IgZWFjaCBsb2cgZ3JvdXAgaW5kaXZpZHVhbGx5XG4gICAgLy8gdG8gbWFrZSBzdXJlIHRoYXQgd2UgcHJvY2VzcyBhbGwgZXZlbnRzIGZyb20gZWFjaCBsb2cgZ3JvdXBcbiAgICBjb25zdCBzdGFydFRpbWUgPSBsb2dHcm91cHNBY2Nlc3NTZXR0aW5ncy5sb2dHcm91cHNTdGFydFRpbWVzW2xvZ0dyb3VwTmFtZV0gPz8gdGhpcy5zdGFydFRpbWU7XG4gICAgbGV0IGVuZFRpbWUgPSBzdGFydFRpbWU7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbG9nR3JvdXBzQWNjZXNzU2V0dGluZ3Muc2RrLmNsb3VkV2F0Y2hMb2dzKCkuZmlsdGVyTG9nRXZlbnRzKHtcbiAgICAgICAgbG9nR3JvdXBOYW1lOiBsb2dHcm91cE5hbWUsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICAgIHN0YXJ0VGltZTogc3RhcnRUaW1lLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBmaWx0ZXJlZEV2ZW50cyA9IHJlc3BvbnNlLmV2ZW50cyA/PyBbXTtcblxuICAgICAgZm9yIChjb25zdCBldmVudCBvZiBmaWx0ZXJlZEV2ZW50cykge1xuICAgICAgICBpZiAoZXZlbnQubWVzc2FnZSkge1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgICAgICAgIG1lc3NhZ2U6IGV2ZW50Lm1lc3NhZ2UsXG4gICAgICAgICAgICBsb2dHcm91cE5hbWUsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IGV2ZW50LnRpbWVzdGFtcCA/IG5ldyBEYXRlKGV2ZW50LnRpbWVzdGFtcCkgOiBuZXcgRGF0ZSgpLFxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgaWYgKGV2ZW50LnRpbWVzdGFtcCAmJiBlbmRUaW1lIDwgZXZlbnQudGltZXN0YW1wKSB7XG4gICAgICAgICAgICBlbmRUaW1lID0gZXZlbnQudGltZXN0YW1wO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gQXMgbG9uZyBhcyB0aGVyZSBhcmUgX2FueV8gZXZlbnRzIGluIHRoZSBsb2cgZ3JvdXAgYGZpbHRlckxvZ0V2ZW50c2Agd2lsbCByZXR1cm4gYSBuZXh0VG9rZW4uXG4gICAgICAvLyBUaGlzIGlzIHRydWUgZXZlbiBpZiB0aGVzZSBldmVudHMgYXJlIGJlZm9yZSBgc3RhcnRUaW1lYC4gU28gaWYgd2UgaGF2ZSAxMDAgZXZlbnRzIGFuZCBhIG5leHRUb2tlblxuICAgICAgLy8gdGhlbiBhc3N1bWUgdGhhdCB3ZSBoYXZlIGhpdCB0aGUgbGltaXQgYW5kIGxldCB0aGUgdXNlciBrbm93IHNvbWUgbWVzc2FnZXMgaGF2ZSBiZWVuIHN1cHByZXNzZWQuXG4gICAgICAvLyBXZSBhcmUgZXNzZW50aWFsbHkgc2hvd2luZyB0aGVtIGEgc2FtcGxpbmcgKDEwMDAwIGV2ZW50cyBwcmludGVkIG91dCBpcyBub3QgdmVyeSB1c2VmdWwpXG4gICAgICBpZiAoZmlsdGVyZWRFdmVudHMubGVuZ3RoID09PSAxMDAgJiYgcmVzcG9uc2UubmV4dFRva2VuKSB7XG4gICAgICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgICAgICBtZXNzYWdlOiAnPj4+IGB3YXRjaGAgc2hvd3Mgb25seSB0aGUgZmlyc3QgMTAwIGxvZyBtZXNzYWdlcyAtIHRoZSByZXN0IGhhdmUgYmVlbiB0cnVuY2F0ZWQuLi4nLFxuICAgICAgICAgIGxvZ0dyb3VwTmFtZSxcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKGVuZFRpbWUpLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIC8vIHdpdGggTGFtYmRhIGZ1bmN0aW9ucyB0aGUgQ2xvdWRXYXRjaCBpcyBub3QgY3JlYXRlZFxuICAgICAgLy8gdW50aWwgc29tZXRoaW5nIGlzIGxvZ2dlZCwgc28ganVzdCBrZWVwIHBvbGxpbmcgdW50aWxcbiAgICAgIC8vIHRoZXJlIGlzIHNvbXRoaW5nIHRvIGZpbmRcbiAgICAgIGlmIChlLm5hbWUgPT09ICdSZXNvdXJjZU5vdEZvdW5kRXhjZXB0aW9uJykge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgICBsb2dHcm91cHNBY2Nlc3NTZXR0aW5ncy5sb2dHcm91cHNTdGFydFRpbWVzW2xvZ0dyb3VwTmFtZV0gPSBlbmRUaW1lICsgMTtcbiAgICByZXR1cm4gZXZlbnRzO1xuICB9XG59XG4iXX0=