"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StackActivityMonitor = void 0;
const util = require("util");
const uuid = require("uuid");
const stack_event_poller_1 = require("./stack-event-poller");
const stack_progress_monitor_1 = require("./stack-progress-monitor");
const util_1 = require("../../util");
const private_1 = require("../io/private");
const resource_metadata_1 = require("../resource-metadata/resource-metadata");
class StackActivityMonitor {
    /**
     * The poller used to read stack events
     */
    poller;
    /**
     * Fetch new activity every 1 second
     * Printers can decide to update a view less frequently if desired
     */
    pollingInterval;
    errors = [];
    monitorId;
    progressMonitor;
    /**
     * Current tick timer
     */
    tickTimer;
    /**
     * Set to the activity of reading the current events
     */
    readPromise;
    ioHelper;
    stackName;
    stack;
    constructor({ cfn, ioHelper, stack, stackName, resourcesTotal, changeSetCreationTime, pollingInterval = 2_000, }) {
        this.ioHelper = ioHelper;
        this.stack = stack;
        this.stackName = stackName;
        this.progressMonitor = new stack_progress_monitor_1.StackProgressMonitor(resourcesTotal);
        this.pollingInterval = pollingInterval;
        this.poller = new stack_event_poller_1.StackEventPoller(cfn, {
            stackName,
            startTime: changeSetCreationTime?.getTime() ?? Date.now(),
        });
    }
    async start() {
        this.monitorId = uuid.v4();
        await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_I5501.msg(`Deploying ${this.stackName}`, {
            deployment: this.monitorId,
            stack: this.stack,
            stackName: this.stackName,
            resourcesTotal: this.progressMonitor.total,
        }));
        this.scheduleNextTick();
        return this;
    }
    async stop() {
        const oldMonitorId = this.monitorId;
        this.monitorId = undefined;
        if (this.tickTimer) {
            clearTimeout(this.tickTimer);
        }
        // Do a final poll for all events. This is to handle the situation where DescribeStackStatus
        // already returned an error, but the monitor hasn't seen all the events yet and we'd end
        // up not printing the failure reason to users.
        await this.finalPollToEnd(oldMonitorId);
        await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_I5503.msg(`Completed ${this.stackName}`, {
            deployment: oldMonitorId,
            stack: this.stack,
            stackName: this.stackName,
            resourcesTotal: this.progressMonitor.total,
        }));
    }
    scheduleNextTick() {
        if (!this.monitorId) {
            return;
        }
        this.tickTimer = setTimeout(() => void this.tick(), this.pollingInterval);
    }
    async tick() {
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
        }
        catch (e) {
            await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_E5500.msg(util.format('Error occurred while monitoring stack: %s', e), { error: e }));
        }
        this.scheduleNextTick();
    }
    findMetadataFor(logicalId) {
        const metadata = this.stack.manifest?.metadata;
        if (!logicalId || !metadata) {
            return undefined;
        }
        return (0, resource_metadata_1.resourceMetadata)(this.stack, logicalId);
    }
    /**
     * Reads all new events from the stack history
     *
     * The events are returned in reverse chronological order; we continue to the next page if we
     * see a next page and the last event in the page is new to us (and within the time window).
     * haven't seen the final event
     */
    async readNewEvents(monitorId) {
        const pollEvents = await this.poller.poll();
        for (const resourceEvent of pollEvents) {
            this.progressMonitor.process(resourceEvent.event);
            const activity = {
                deployment: monitorId,
                event: resourceEvent.event,
                metadata: this.findMetadataFor(resourceEvent.event.LogicalResourceId),
                progress: this.progressMonitor.progress,
            };
            this.checkForErrors(activity);
            await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_I5502.msg(this.formatActivity(activity, true), activity));
        }
    }
    /**
     * Perform a final poll to the end and flush out all events to the printer
     *
     * Finish any poll currently in progress, then do a final one until we've
     * reached the last page.
     */
    async finalPollToEnd(monitorId) {
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
    formatActivity(activity, progress) {
        const event = activity.event;
        const metadata = activity.metadata;
        const resourceName = metadata ? metadata.constructPath : event.LogicalResourceId || '';
        const logicalId = resourceName !== event.LogicalResourceId ? `(${event.LogicalResourceId}) ` : '';
        return util.format('%s | %s%s | %s | %s | %s %s%s%s', event.StackName, progress !== false ? `${activity.progress.formatted} | ` : '', new Date(event.Timestamp).toLocaleTimeString(), event.ResourceStatus || '', event.ResourceType, resourceName, logicalId, event.ResourceStatusReason ? event.ResourceStatusReason : '', metadata?.entry.trace ? `\n\t${metadata.entry.trace.join('\n\t\\_ ')}` : '');
    }
    checkForErrors(activity) {
        if ((0, util_1.stackEventHasErrorMessage)(activity.event.ResourceStatus ?? '')) {
            const isCancelled = (activity.event.ResourceStatusReason ?? '').indexOf('cancelled') > -1;
            // Cancelled is not an interesting failure reason, nor is the stack message (stack
            // message will just say something like "stack failed to update")
            if (!isCancelled && activity.event.StackName !== activity.event.LogicalResourceId) {
                this.errors.push(activity.event.ResourceStatusReason ?? '');
            }
        }
    }
}
exports.StackActivityMonitor = StackActivityMonitor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stYWN0aXZpdHktbW9uaXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvc3RhY2stZXZlbnRzL3N0YWNrLWFjdGl2aXR5LW1vbml0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkJBQTZCO0FBRzdCLDZCQUE2QjtBQUM3Qiw2REFBd0Q7QUFDeEQscUVBQWdFO0FBQ2hFLHFDQUF1RDtBQUV2RCwyQ0FBa0Q7QUFDbEQsOEVBQTBFO0FBdUQxRSxNQUFhLG9CQUFvQjtJQUMvQjs7T0FFRztJQUNjLE1BQU0sQ0FBbUI7SUFFMUM7OztPQUdHO0lBQ2MsZUFBZSxDQUFTO0lBRXpCLE1BQU0sR0FBYSxFQUFFLENBQUM7SUFFOUIsU0FBUyxDQUFVO0lBRVYsZUFBZSxDQUF1QjtJQUV2RDs7T0FFRztJQUNLLFNBQVMsQ0FBaUM7SUFFbEQ7O09BRUc7SUFDSyxXQUFXLENBQWdCO0lBRWxCLFFBQVEsQ0FBVztJQUNuQixTQUFTLENBQVM7SUFDbEIsS0FBSyxDQUE4QjtJQUVwRCxZQUFZLEVBQ1YsR0FBRyxFQUNILFFBQVEsRUFDUixLQUFLLEVBQ0wsU0FBUyxFQUNULGNBQWMsRUFDZCxxQkFBcUIsRUFDckIsZUFBZSxHQUFHLEtBQUssR0FDRztRQUMxQixJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUN6QixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztRQUNuQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUUzQixJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksNkNBQW9CLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDaEUsSUFBSSxDQUFDLGVBQWUsR0FBRyxlQUFlLENBQUM7UUFDdkMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLHFDQUFnQixDQUFDLEdBQUcsRUFBRTtZQUN0QyxTQUFTO1lBQ1QsU0FBUyxFQUFFLHFCQUFxQixFQUFFLE9BQU8sRUFBRSxJQUFJLElBQUks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QUUsQ0FDNUUsQ0FBQztJQUNKLENBQUM7SUFFTyxjQUFjLENBQUMsUUFBdUI7UUFDNUMsSUFBSSxJQUFBLGdDQUF5QixFQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDbkUsTUFBTSxXQUFXLEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLG9CQUFvQixJQUFJLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztZQUUxRixrRkFBa0Y7WUFDbEYsaUVBQWlFO1lBQ2pFLElBQUksQ0FBQyxXQUFXLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxTQUFTLEtBQUssUUFBUSxDQUFDLEtBQUssQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUNsRixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLG9CQUFvQixJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQzlELENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBMU1ELG9EQTBNQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHV0aWwgZnJvbSAndXRpbCc7XG5pbXBvcnQgdHlwZSB7IENsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCB9IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgdHlwZSB7IFN0YWNrQWN0aXZpdHkgfSBmcm9tICdAYXdzLWNkay90bXAtdG9vbGtpdC1oZWxwZXJzJztcbmltcG9ydCAqIGFzIHV1aWQgZnJvbSAndXVpZCc7XG5pbXBvcnQgeyBTdGFja0V2ZW50UG9sbGVyIH0gZnJvbSAnLi9zdGFjay1ldmVudC1wb2xsZXInO1xuaW1wb3J0IHsgU3RhY2tQcm9ncmVzc01vbml0b3IgfSBmcm9tICcuL3N0YWNrLXByb2dyZXNzLW1vbml0b3InO1xuaW1wb3J0IHsgc3RhY2tFdmVudEhhc0Vycm9yTWVzc2FnZSB9IGZyb20gJy4uLy4uL3V0aWwnO1xuaW1wb3J0IHR5cGUgeyBJQ2xvdWRGb3JtYXRpb25DbGllbnQgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgeyBJTywgdHlwZSBJb0hlbHBlciB9IGZyb20gJy4uL2lvL3ByaXZhdGUnO1xuaW1wb3J0IHsgcmVzb3VyY2VNZXRhZGF0YSB9IGZyb20gJy4uL3Jlc291cmNlLW1ldGFkYXRhL3Jlc291cmNlLW1ldGFkYXRhJztcblxuZXhwb3J0IGludGVyZmFjZSBTdGFja0FjdGl2aXR5TW9uaXRvclByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBDbG91ZEZvcm1hdGlvbiBjbGllbnRcbiAgICovXG4gIHJlYWRvbmx5IGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50O1xuXG4gIC8qKlxuICAgKiBUaGUgSW9IZWxwZXIgdXNlZCBmb3IgbWVzc2FnaW5nXG4gICAqL1xuICByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBzdGFjayBhcnRpZmFjdCB0aGF0IGlzIGdldHRpbmcgZGVwbG95ZWRcbiAgICovXG4gIHJlYWRvbmx5IHN0YWNrOiBDbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q7XG5cbiAgLyoqXG4gICAqIFRoZSBuYW1lIG9mIHRoZSBTdGFjayB0aGF0IGlzIGdldHRpbmcgZGVwbG95ZWRcbiAgICovXG4gIHJlYWRvbmx5IHN0YWNrTmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUb3RhbCBudW1iZXIgb2YgcmVzb3VyY2VzIHRvIHVwZGF0ZVxuICAgKlxuICAgKiBVc2VkIHRvIGNhbGN1bGF0ZSBhIHByb2dyZXNzIGJhci5cbiAgICpcbiAgICogQGRlZmF1bHQgLSBObyBwcm9ncmVzcyByZXBvcnRpbmcuXG4gICAqL1xuICByZWFkb25seSByZXNvdXJjZXNUb3RhbD86IG51bWJlcjtcblxuICAvKipcbiAgICogQ3JlYXRpb24gdGltZSBvZiB0aGUgY2hhbmdlIHNldFxuICAgKlxuICAgKiBUaGlzIHdpbGwgYmUgdXNlZCB0byBmaWx0ZXIgZXZlbnRzLCBvbmx5IHNob3dpbmcgdGhvc2UgZnJvbSBhZnRlciB0aGUgY2hhbmdlXG4gICAqIHNldCBjcmVhdGlvbiB0aW1lLlxuICAgKlxuICAgKiBJdCBpcyByZWNvbW1lbmRlZCB0byB1c2UgdGhpcywgb3RoZXJ3aXNlIHRoZSBmaWx0ZXJpbmcgd2lsbCBiZSBzdWJqZWN0XG4gICAqIHRvIGNsb2NrIGRyaWZ0IGJldHdlZW4gbG9jYWwgYW5kIGNsb3VkIG1hY2hpbmVzLlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIGxvY2FsIG1hY2hpbmUncyBjdXJyZW50IHRpbWVcbiAgICovXG4gIHJlYWRvbmx5IGNoYW5nZVNldENyZWF0aW9uVGltZT86IERhdGU7XG5cbiAgLyoqXG4gICAqIFRpbWUgdG8gd2FpdCBiZXR3ZWVuIGZldGNoaW5nIG5ldyBhY3Rpdml0aWVzLlxuICAgKlxuICAgKiBNdXN0IHdhaXQgYSByZWFzb25hYmxlIGFtb3VudCBvZiB0aW1lIGJldHdlZW4gcG9sbHMsIHNpbmNlIHdlIG5lZWQgdG8gY29uc2lkZXIgQ2xvdWRGb3JtYXRpb24gQVBJIGxpbWl0c1xuICAgKlxuICAgKiBAZGVmYXVsdCAyXzAwMFxuICAgKi9cbiAgcmVhZG9ubHkgcG9sbGluZ0ludGVydmFsPzogbnVtYmVyO1xufVxuXG5leHBvcnQgY2xhc3MgU3RhY2tBY3Rpdml0eU1vbml0b3Ige1xuICAvKipcbiAgICogVGhlIHBvbGxlciB1c2VkIHRvIHJlYWQgc3RhY2sgZXZlbnRzXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHBvbGxlcjogU3RhY2tFdmVudFBvbGxlcjtcblxuICAvKipcbiAgICogRmV0Y2ggbmV3IGFjdGl2aXR5IGV2ZXJ5IDEgc2Vjb25kXG4gICAqIFByaW50ZXJzIGNhbiBkZWNpZGUgdG8gdXBkYXRlIGEgdmlldyBsZXNzIGZyZXF1ZW50bHkgaWYgZGVzaXJlZFxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBwb2xsaW5nSW50ZXJ2YWw6IG51bWJlcjtcblxuICBwdWJsaWMgcmVhZG9ubHkgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIHByaXZhdGUgbW9uaXRvcklkPzogc3RyaW5nO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvZ3Jlc3NNb25pdG9yOiBTdGFja1Byb2dyZXNzTW9uaXRvcjtcblxuICAvKipcbiAgICogQ3VycmVudCB0aWNrIHRpbWVyXG4gICAqL1xuICBwcml2YXRlIHRpY2tUaW1lcj86IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+O1xuXG4gIC8qKlxuICAgKiBTZXQgdG8gdGhlIGFjdGl2aXR5IG9mIHJlYWRpbmcgdGhlIGN1cnJlbnQgZXZlbnRzXG4gICAqL1xuICBwcml2YXRlIHJlYWRQcm9taXNlPzogUHJvbWlzZTxhbnk+O1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgaW9IZWxwZXI6IElvSGVscGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YWNrTmFtZTogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YWNrOiBDbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q7XG5cbiAgY29uc3RydWN0b3Ioe1xuICAgIGNmbixcbiAgICBpb0hlbHBlcixcbiAgICBzdGFjayxcbiAgICBzdGFja05hbWUsXG4gICAgcmVzb3VyY2VzVG90YWwsXG4gICAgY2hhbmdlU2V0Q3JlYXRpb25UaW1lLFxuICAgIHBvbGxpbmdJbnRlcnZhbCA9IDJfMDAwLFxuICB9OiBTdGFja0FjdGl2aXR5TW9uaXRvclByb3BzKSB7XG4gICAgdGhpcy5pb0hlbHBlciA9IGlvSGVscGVyO1xuICAgIHRoaXMuc3RhY2sgPSBzdGFjaztcbiAgICB0aGlzLnN0YWNrTmFtZSA9IHN0YWNrTmFtZTtcblxuICAgIHRoaXMucHJvZ3Jlc3NNb25pdG9yID0gbmV3IFN0YWNrUHJvZ3Jlc3NNb25pdG9yKHJlc291cmNlc1RvdGFsKTtcbiAgICB0aGlzLnBvbGxpbmdJbnRlcnZhbCA9IHBvbGxpbmdJbnRlcnZhbDtcbiAgICB0aGlzLnBvbGxlciA9IG5ldyBTdGFja0V2ZW50UG9sbGVyKGNmbiwge1xuICAgICAgc3RhY2tOYW1lLFxuICAgICAgc3RhcnRUaW1lOiBjaGFuZ2VTZXRDcmVhdGlvblRpbWU/LmdldFRpbWUoKSA/PyBEYXRlLm5vdygpLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHN0YXJ0KCkge1xuICAgIHRoaXMubW9uaXRvcklkID0gdXVpZC52NCgpO1xuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkNES19UT09MS0lUX0k1NTAxLm1zZyhgRGVwbG95aW5nICR7dGhpcy5zdGFja05hbWV9YCwge1xuICAgICAgZGVwbG95bWVudDogdGhpcy5tb25pdG9ySWQsXG4gICAgICBzdGFjazogdGhpcy5zdGFjayxcbiAgICAgIHN0YWNrTmFtZTogdGhpcy5zdGFja05hbWUsXG4gICAgICByZXNvdXJjZXNUb3RhbDogdGhpcy5wcm9ncmVzc01vbml0b3IudG90YWwsXG4gICAgfSkpO1xuICAgIHRoaXMuc2NoZWR1bGVOZXh0VGljaygpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHN0b3AoKSB7XG4gICAgY29uc3Qgb2xkTW9uaXRvcklkID0gdGhpcy5tb25pdG9ySWQhO1xuICAgIHRoaXMubW9uaXRvcklkID0gdW5kZWZpbmVkO1xuICAgIGlmICh0aGlzLnRpY2tUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMudGlja1RpbWVyKTtcbiAgICB9XG5cbiAgICAvLyBEbyBhIGZpbmFsIHBvbGwgZm9yIGFsbCBldmVudHMuIFRoaXMgaXMgdG8gaGFuZGxlIHRoZSBzaXR1YXRpb24gd2hlcmUgRGVzY3JpYmVTdGFja1N0YXR1c1xuICAgIC8vIGFscmVhZHkgcmV0dXJuZWQgYW4gZXJyb3IsIGJ1dCB0aGUgbW9uaXRvciBoYXNuJ3Qgc2VlbiBhbGwgdGhlIGV2ZW50cyB5ZXQgYW5kIHdlJ2QgZW5kXG4gICAgLy8gdXAgbm90IHByaW50aW5nIHRoZSBmYWlsdXJlIHJlYXNvbiB0byB1c2Vycy5cbiAgICBhd2FpdCB0aGlzLmZpbmFsUG9sbFRvRW5kKG9sZE1vbml0b3JJZCk7XG5cbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5DREtfVE9PTEtJVF9JNTUwMy5tc2coYENvbXBsZXRlZCAke3RoaXMuc3RhY2tOYW1lfWAsIHtcbiAgICAgIGRlcGxveW1lbnQ6IG9sZE1vbml0b3JJZCxcbiAgICAgIHN0YWNrOiB0aGlzLnN0YWNrLFxuICAgICAgc3RhY2tOYW1lOiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgIHJlc291cmNlc1RvdGFsOiB0aGlzLnByb2dyZXNzTW9uaXRvci50b3RhbCxcbiAgICB9KSk7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlTmV4dFRpY2soKSB7XG4gICAgaWYgKCF0aGlzLm1vbml0b3JJZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMudGlja1RpbWVyID0gc2V0VGltZW91dCgoKSA9PiB2b2lkIHRoaXMudGljaygpLCB0aGlzLnBvbGxpbmdJbnRlcnZhbCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHRpY2soKSB7XG4gICAgaWYgKCF0aGlzLm1vbml0b3JJZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB0aGlzLnJlYWRQcm9taXNlID0gdGhpcy5yZWFkTmV3RXZlbnRzKHRoaXMubW9uaXRvcklkKTtcbiAgICAgIGF3YWl0IHRoaXMucmVhZFByb21pc2U7XG4gICAgICB0aGlzLnJlYWRQcm9taXNlID0gdW5kZWZpbmVkO1xuXG4gICAgICAvLyBXZSBtaWdodCBoYXZlIGJlZW4gc3RvcCgpcGVkIHdoaWxlIHRoZSBuZXR3b3JrIGNhbGwgd2FzIGluIHByb2dyZXNzLlxuICAgICAgaWYgKCF0aGlzLm1vbml0b3JJZCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uQ0RLX1RPT0xLSVRfRTU1MDAubXNnKFxuICAgICAgICB1dGlsLmZvcm1hdCgnRXJyb3Igb2NjdXJyZWQgd2hpbGUgbW9uaXRvcmluZyBzdGFjazogJXMnLCBlKSxcbiAgICAgICAgeyBlcnJvcjogZSBhcyBhbnkgfSxcbiAgICAgICkpO1xuICAgIH1cbiAgICB0aGlzLnNjaGVkdWxlTmV4dFRpY2soKTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZE1ldGFkYXRhRm9yKGxvZ2ljYWxJZDogc3RyaW5nIHwgdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnN0YWNrLm1hbmlmZXN0Py5tZXRhZGF0YTtcbiAgICBpZiAoIWxvZ2ljYWxJZCB8fCAhbWV0YWRhdGEpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiByZXNvdXJjZU1ldGFkYXRhKHRoaXMuc3RhY2ssIGxvZ2ljYWxJZCk7XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYWxsIG5ldyBldmVudHMgZnJvbSB0aGUgc3RhY2sgaGlzdG9yeVxuICAgKlxuICAgKiBUaGUgZXZlbnRzIGFyZSByZXR1cm5lZCBpbiByZXZlcnNlIGNocm9ub2xvZ2ljYWwgb3JkZXI7IHdlIGNvbnRpbnVlIHRvIHRoZSBuZXh0IHBhZ2UgaWYgd2VcbiAgICogc2VlIGEgbmV4dCBwYWdlIGFuZCB0aGUgbGFzdCBldmVudCBpbiB0aGUgcGFnZSBpcyBuZXcgdG8gdXMgKGFuZCB3aXRoaW4gdGhlIHRpbWUgd2luZG93KS5cbiAgICogaGF2ZW4ndCBzZWVuIHRoZSBmaW5hbCBldmVudFxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyByZWFkTmV3RXZlbnRzKG1vbml0b3JJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcG9sbEV2ZW50cyA9IGF3YWl0IHRoaXMucG9sbGVyLnBvbGwoKTtcblxuICAgIGZvciAoY29uc3QgcmVzb3VyY2VFdmVudCBvZiBwb2xsRXZlbnRzKSB7XG4gICAgICB0aGlzLnByb2dyZXNzTW9uaXRvci5wcm9jZXNzKHJlc291cmNlRXZlbnQuZXZlbnQpO1xuXG4gICAgICBjb25zdCBhY3Rpdml0eTogU3RhY2tBY3Rpdml0eSA9IHtcbiAgICAgICAgZGVwbG95bWVudDogbW9uaXRvcklkLFxuICAgICAgICBldmVudDogcmVzb3VyY2VFdmVudC5ldmVudCxcbiAgICAgICAgbWV0YWRhdGE6IHRoaXMuZmluZE1ldGFkYXRhRm9yKHJlc291cmNlRXZlbnQuZXZlbnQuTG9naWNhbFJlc291cmNlSWQpLFxuICAgICAgICBwcm9ncmVzczogdGhpcy5wcm9ncmVzc01vbml0b3IucHJvZ3Jlc3MsXG4gICAgICB9O1xuXG4gICAgICB0aGlzLmNoZWNrRm9yRXJyb3JzKGFjdGl2aXR5KTtcbiAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkNES19UT09MS0lUX0k1NTAyLm1zZyh0aGlzLmZvcm1hdEFjdGl2aXR5KGFjdGl2aXR5LCB0cnVlKSwgYWN0aXZpdHkpKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybSBhIGZpbmFsIHBvbGwgdG8gdGhlIGVuZCBhbmQgZmx1c2ggb3V0IGFsbCBldmVudHMgdG8gdGhlIHByaW50ZXJcbiAgICpcbiAgICogRmluaXNoIGFueSBwb2xsIGN1cnJlbnRseSBpbiBwcm9ncmVzcywgdGhlbiBkbyBhIGZpbmFsIG9uZSB1bnRpbCB3ZSd2ZVxuICAgKiByZWFjaGVkIHRoZSBsYXN0IHBhZ2UuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGZpbmFsUG9sbFRvRW5kKG1vbml0b3JJZDogc3RyaW5nKSB7XG4gICAgLy8gSWYgd2Ugd2VyZSBkb2luZyBhIHBvbGwsIGZpbmlzaCB0aGF0IGZpcnN0LiBJdCB3YXMgc3RhcnRlZCBiZWZvcmVcbiAgICAvLyB0aGUgbW9tZW50IHdlIHdlcmUgc3VyZSB3ZSB3ZXJlbid0IGdvaW5nIHRvIGdldCBhbnkgbmV3IGV2ZW50cyBhbnltb3JlXG4gICAgLy8gc28gd2UgbmVlZCB0byBkbyBhIG5ldyBvbmUgYW55d2F5LiBOZWVkIHRvIHdhaXQgZm9yIHRoaXMgb25lIHRob3VnaFxuICAgIC8vIGJlY2F1c2Ugb3VyIHN0YXRlIGlzIHNpbmdsZS10aHJlYWRlZC5cbiAgICBpZiAodGhpcy5yZWFkUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWFkUHJvbWlzZTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlYWROZXdFdmVudHMobW9uaXRvcklkKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JtYXRzIGEgc3RhY2sgYWN0aXZpdHkgaW50byBhIGJhc2ljIHN0cmluZ1xuICAgKi9cbiAgcHJpdmF0ZSBmb3JtYXRBY3Rpdml0eShhY3Rpdml0eTogU3RhY2tBY3Rpdml0eSwgcHJvZ3Jlc3M6IGJvb2xlYW4pOiBzdHJpbmcge1xuICAgIGNvbnN0IGV2ZW50ID0gYWN0aXZpdHkuZXZlbnQ7XG4gICAgY29uc3QgbWV0YWRhdGEgPSBhY3Rpdml0eS5tZXRhZGF0YTtcblxuICAgIGNvbnN0IHJlc291cmNlTmFtZSA9IG1ldGFkYXRhID8gbWV0YWRhdGEuY29uc3RydWN0UGF0aCA6IGV2ZW50LkxvZ2ljYWxSZXNvdXJjZUlkIHx8ICcnO1xuICAgIGNvbnN0IGxvZ2ljYWxJZCA9IHJlc291cmNlTmFtZSAhPT0gZXZlbnQuTG9naWNhbFJlc291cmNlSWQgPyBgKCR7ZXZlbnQuTG9naWNhbFJlc291cmNlSWR9KSBgIDogJyc7XG5cbiAgICByZXR1cm4gdXRpbC5mb3JtYXQoXG4gICAgICAnJXMgfCAlcyVzIHwgJXMgfCAlcyB8ICVzICVzJXMlcycsXG4gICAgICBldmVudC5TdGFja05hbWUsXG4gICAgICBwcm9ncmVzcyAhPT0gZmFsc2UgPyBgJHthY3Rpdml0eS5wcm9ncmVzcy5mb3JtYXR0ZWR9IHwgYCA6ICcnLFxuICAgICAgbmV3IERhdGUoZXZlbnQuVGltZXN0YW1wISkudG9Mb2NhbGVUaW1lU3RyaW5nKCksXG4gICAgICBldmVudC5SZXNvdXJjZVN0YXR1cyB8fCAnJyxcbiAgICAgIGV2ZW50LlJlc291cmNlVHlwZSxcbiAgICAgIHJlc291cmNlTmFtZSxcbiAgICAgIGxvZ2ljYWxJZCxcbiAgICAgIGV2ZW50LlJlc291cmNlU3RhdHVzUmVhc29uID8gZXZlbnQuUmVzb3VyY2VTdGF0dXNSZWFzb24gOiAnJyxcbiAgICAgIG1ldGFkYXRhPy5lbnRyeS50cmFjZSA/IGBcXG5cXHQke21ldGFkYXRhLmVudHJ5LnRyYWNlLmpvaW4oJ1xcblxcdFxcXFxfICcpfWAgOiAnJyxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBjaGVja0ZvckVycm9ycyhhY3Rpdml0eTogU3RhY2tBY3Rpdml0eSkge1xuICAgIGlmIChzdGFja0V2ZW50SGFzRXJyb3JNZXNzYWdlKGFjdGl2aXR5LmV2ZW50LlJlc291cmNlU3RhdHVzID8/ICcnKSkge1xuICAgICAgY29uc3QgaXNDYW5jZWxsZWQgPSAoYWN0aXZpdHkuZXZlbnQuUmVzb3VyY2VTdGF0dXNSZWFzb24gPz8gJycpLmluZGV4T2YoJ2NhbmNlbGxlZCcpID4gLTE7XG5cbiAgICAgIC8vIENhbmNlbGxlZCBpcyBub3QgYW4gaW50ZXJlc3RpbmcgZmFpbHVyZSByZWFzb24sIG5vciBpcyB0aGUgc3RhY2sgbWVzc2FnZSAoc3RhY2tcbiAgICAgIC8vIG1lc3NhZ2Ugd2lsbCBqdXN0IHNheSBzb21ldGhpbmcgbGlrZSBcInN0YWNrIGZhaWxlZCB0byB1cGRhdGVcIilcbiAgICAgIGlmICghaXNDYW5jZWxsZWQgJiYgYWN0aXZpdHkuZXZlbnQuU3RhY2tOYW1lICE9PSBhY3Rpdml0eS5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCkge1xuICAgICAgICB0aGlzLmVycm9ycy5wdXNoKGFjdGl2aXR5LmV2ZW50LlJlc291cmNlU3RhdHVzUmVhc29uID8/ICcnKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==