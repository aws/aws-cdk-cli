"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StackProgressMonitor = void 0;
const util = require("util");
const util_1 = require("../../util");
/**
 * Monitors stack progress.s
 */
class StackProgressMonitor {
    /**
     * Previous completion state observed by logical ID
     *
     * We use this to detect that if we see a DELETE_COMPLETE after a
     * CREATE_COMPLETE, it's actually a rollback and we should DECREASE
     * resourcesDone instead of increase it
     */
    resourcesPrevCompleteState = {};
    /**
     * Count of resources that have reported a _COMPLETE status
     */
    resourcesDone = 0;
    /**
     * How many digits we need to represent the total count (for lining up the status reporting)
     */
    resourceDigits = 0;
    /**
     * Number of expected resources in the monitor.
     */
    resourcesTotal;
    constructor(resourcesTotal) {
        // +1 because the stack also emits a "COMPLETE" event at the end, and that wasn't
        // counted yet. This makes it line up with the amount of events we expect.
        this.resourcesTotal = resourcesTotal ? resourcesTotal + 1 : undefined;
        // How many digits does this number take to represent?
        this.resourceDigits = this.resourcesTotal ? Math.ceil(Math.log10(this.resourcesTotal)) : 0;
    }
    /**
     * Report the stack progress
     */
    get progress() {
        return {
            total: this.total,
            completed: this.completed,
            formatted: this.formatted,
        };
    }
    /**
     * The total number of progress monitored resources.
     */
    get total() {
        return this.resourcesTotal;
    }
    /**
     * The number of completed resources.
     */
    get completed() {
        return this.resourcesDone;
    }
    /**
     * Report the current progress as a [34/42] string, or just [34] if the total is unknown
     */
    get formatted() {
        if (this.resourcesTotal == null) {
            // Don't have total, show simple count and hope the human knows
            return (0, util_1.padLeft)(3, util.format('%s', this.resourcesDone)); // max 500 resources
        }
        return util.format('%s/%s', (0, util_1.padLeft)(this.resourceDigits, this.resourcesDone.toString()), (0, util_1.padLeft)(this.resourceDigits, this.resourcesTotal.toString()));
    }
    /**
     * Process as stack event and update the progress state.
     */
    process(event) {
        const status = event.ResourceStatus;
        if (!status || !event.LogicalResourceId) {
            return;
        }
        if (status.endsWith('_COMPLETE_CLEANUP_IN_PROGRESS')) {
            this.resourcesDone++;
        }
        if (status.endsWith('_COMPLETE')) {
            const prevState = this.resourcesPrevCompleteState[event.LogicalResourceId];
            if (!prevState) {
                this.resourcesDone++;
            }
            else {
                // If we completed this before and we're completing it AGAIN, means we're rolling back.
                // Protect against silly underflow.
                this.resourcesDone--;
                if (this.resourcesDone < 0) {
                    this.resourcesDone = 0;
                }
            }
            this.resourcesPrevCompleteState[event.LogicalResourceId] = status;
        }
    }
}
exports.StackProgressMonitor = StackProgressMonitor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stcHJvZ3Jlc3MtbW9uaXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvc3RhY2stZXZlbnRzL3N0YWNrLXByb2dyZXNzLW1vbml0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkJBQTZCO0FBRzdCLHFDQUFxQztBQUVyQzs7R0FFRztBQUNILE1BQWEsb0JBQW9CO0lBQy9COzs7Ozs7T0FNRztJQUNLLDBCQUEwQixHQUEyQixFQUFFLENBQUM7SUFFaEU7O09BRUc7SUFDSyxhQUFhLEdBQVcsQ0FBQyxDQUFDO0lBRWxDOztPQUVHO0lBQ2MsY0FBYyxHQUFXLENBQUMsQ0FBQztJQUU1Qzs7T0FFRztJQUNjLGNBQWMsQ0FBVTtJQUV6QyxZQUFZLGNBQXVCO1FBQ2pDLGlGQUFpRjtRQUNqRiwwRUFBMEU7UUFDMUUsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUMsQ0FBQyxDQUFDLGNBQWMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUV0RSxzREFBc0Q7UUFDdEQsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUM3RixDQUFDO0lBRUQ7O09BRUc7SUFDSCxJQUFXLFFBQVE7UUFDakIsT0FBTztZQUNMLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSztZQUNqQixTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDekIsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO1NBQzFCLENBQUM7SUFDSixDQUFDO0lBRUQ7O09BRUc7SUFDSCxJQUFXLEtBQUs7UUFDZCxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUM7SUFDN0IsQ0FBQztJQUVEOztPQUVHO0lBQ0gsSUFBVyxTQUFTO1FBQ2xCLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQztJQUM1QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxJQUFXLFNBQVM7UUFDbEIsSUFBSSxJQUFJLENBQUMsY0FBYyxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ2hDLCtEQUErRDtZQUMvRCxPQUFPLElBQUEsY0FBTyxFQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQjtRQUNoRixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUNoQixPQUFPLEVBQ1AsSUFBQSxjQUFPLEVBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsRUFBRSxDQUFDLEVBQzNELElBQUEsY0FBTyxFQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUM3RCxDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ0ksT0FBTyxDQUFDLEtBQWlCO1FBQzlCLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxjQUFjLENBQUM7UUFDcEMsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3hDLE9BQU87UUFDVCxDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLCtCQUErQixDQUFDLEVBQUUsQ0FBQztZQUNyRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDdkIsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1lBQ2pDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUMzRSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQ3ZCLENBQUM7aUJBQU0sQ0FBQztnQkFDTix1RkFBdUY7Z0JBQ3ZGLG1DQUFtQztnQkFDbkMsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO2dCQUNyQixJQUFJLElBQUksQ0FBQyxhQUFhLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQzNCLElBQUksQ0FBQyxhQUFhLEdBQUcsQ0FBQyxDQUFDO2dCQUN6QixDQUFDO1lBQ0gsQ0FBQztZQUNELElBQUksQ0FBQywwQkFBMEIsQ0FBQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsR0FBRyxNQUFNLENBQUM7UUFDcEUsQ0FBQztJQUNILENBQUM7Q0FDRjtBQXZHRCxvREF1R0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyB1dGlsIGZyb20gJ3V0aWwnO1xuaW1wb3J0IHR5cGUgeyBTdGFja1Byb2dyZXNzIH0gZnJvbSAnQGF3cy1jZGsvdG1wLXRvb2xraXQtaGVscGVycyc7XG5pbXBvcnQgdHlwZSB7IFN0YWNrRXZlbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtY2xvdWRmb3JtYXRpb24nO1xuaW1wb3J0IHsgcGFkTGVmdCB9IGZyb20gJy4uLy4uL3V0aWwnO1xuXG4vKipcbiAqIE1vbml0b3JzIHN0YWNrIHByb2dyZXNzLnNcbiAqL1xuZXhwb3J0IGNsYXNzIFN0YWNrUHJvZ3Jlc3NNb25pdG9yIHtcbiAgLyoqXG4gICAqIFByZXZpb3VzIGNvbXBsZXRpb24gc3RhdGUgb2JzZXJ2ZWQgYnkgbG9naWNhbCBJRFxuICAgKlxuICAgKiBXZSB1c2UgdGhpcyB0byBkZXRlY3QgdGhhdCBpZiB3ZSBzZWUgYSBERUxFVEVfQ09NUExFVEUgYWZ0ZXIgYVxuICAgKiBDUkVBVEVfQ09NUExFVEUsIGl0J3MgYWN0dWFsbHkgYSByb2xsYmFjayBhbmQgd2Ugc2hvdWxkIERFQ1JFQVNFXG4gICAqIHJlc291cmNlc0RvbmUgaW5zdGVhZCBvZiBpbmNyZWFzZSBpdFxuICAgKi9cbiAgcHJpdmF0ZSByZXNvdXJjZXNQcmV2Q29tcGxldGVTdGF0ZTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXG4gIC8qKlxuICAgKiBDb3VudCBvZiByZXNvdXJjZXMgdGhhdCBoYXZlIHJlcG9ydGVkIGEgX0NPTVBMRVRFIHN0YXR1c1xuICAgKi9cbiAgcHJpdmF0ZSByZXNvdXJjZXNEb25lOiBudW1iZXIgPSAwO1xuXG4gIC8qKlxuICAgKiBIb3cgbWFueSBkaWdpdHMgd2UgbmVlZCB0byByZXByZXNlbnQgdGhlIHRvdGFsIGNvdW50IChmb3IgbGluaW5nIHVwIHRoZSBzdGF0dXMgcmVwb3J0aW5nKVxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSByZXNvdXJjZURpZ2l0czogbnVtYmVyID0gMDtcblxuICAvKipcbiAgICogTnVtYmVyIG9mIGV4cGVjdGVkIHJlc291cmNlcyBpbiB0aGUgbW9uaXRvci5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgcmVzb3VyY2VzVG90YWw/OiBudW1iZXI7XG5cbiAgY29uc3RydWN0b3IocmVzb3VyY2VzVG90YWw/OiBudW1iZXIpIHtcbiAgICAvLyArMSBiZWNhdXNlIHRoZSBzdGFjayBhbHNvIGVtaXRzIGEgXCJDT01QTEVURVwiIGV2ZW50IGF0IHRoZSBlbmQsIGFuZCB0aGF0IHdhc24ndFxuICAgIC8vIGNvdW50ZWQgeWV0LiBUaGlzIG1ha2VzIGl0IGxpbmUgdXAgd2l0aCB0aGUgYW1vdW50IG9mIGV2ZW50cyB3ZSBleHBlY3QuXG4gICAgdGhpcy5yZXNvdXJjZXNUb3RhbCA9IHJlc291cmNlc1RvdGFsID8gcmVzb3VyY2VzVG90YWwgKyAxIDogdW5kZWZpbmVkO1xuXG4gICAgLy8gSG93IG1hbnkgZGlnaXRzIGRvZXMgdGhpcyBudW1iZXIgdGFrZSB0byByZXByZXNlbnQ/XG4gICAgdGhpcy5yZXNvdXJjZURpZ2l0cyA9IHRoaXMucmVzb3VyY2VzVG90YWwgPyBNYXRoLmNlaWwoTWF0aC5sb2cxMCh0aGlzLnJlc291cmNlc1RvdGFsKSkgOiAwO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydCB0aGUgc3RhY2sgcHJvZ3Jlc3NcbiAgICovXG4gIHB1YmxpYyBnZXQgcHJvZ3Jlc3MoKTogU3RhY2tQcm9ncmVzcyB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRvdGFsOiB0aGlzLnRvdGFsLFxuICAgICAgY29tcGxldGVkOiB0aGlzLmNvbXBsZXRlZCxcbiAgICAgIGZvcm1hdHRlZDogdGhpcy5mb3JtYXR0ZWQsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgdG90YWwgbnVtYmVyIG9mIHByb2dyZXNzIG1vbml0b3JlZCByZXNvdXJjZXMuXG4gICAqL1xuICBwdWJsaWMgZ2V0IHRvdGFsKCk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VzVG90YWw7XG4gIH1cblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBjb21wbGV0ZWQgcmVzb3VyY2VzLlxuICAgKi9cbiAgcHVibGljIGdldCBjb21wbGV0ZWQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZXNEb25lO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydCB0aGUgY3VycmVudCBwcm9ncmVzcyBhcyBhIFszNC80Ml0gc3RyaW5nLCBvciBqdXN0IFszNF0gaWYgdGhlIHRvdGFsIGlzIHVua25vd25cbiAgICovXG4gIHB1YmxpYyBnZXQgZm9ybWF0dGVkKCk6IHN0cmluZyB7XG4gICAgaWYgKHRoaXMucmVzb3VyY2VzVG90YWwgPT0gbnVsbCkge1xuICAgICAgLy8gRG9uJ3QgaGF2ZSB0b3RhbCwgc2hvdyBzaW1wbGUgY291bnQgYW5kIGhvcGUgdGhlIGh1bWFuIGtub3dzXG4gICAgICByZXR1cm4gcGFkTGVmdCgzLCB1dGlsLmZvcm1hdCgnJXMnLCB0aGlzLnJlc291cmNlc0RvbmUpKTsgLy8gbWF4IDUwMCByZXNvdXJjZXNcbiAgICB9XG5cbiAgICByZXR1cm4gdXRpbC5mb3JtYXQoXG4gICAgICAnJXMvJXMnLFxuICAgICAgcGFkTGVmdCh0aGlzLnJlc291cmNlRGlnaXRzLCB0aGlzLnJlc291cmNlc0RvbmUudG9TdHJpbmcoKSksXG4gICAgICBwYWRMZWZ0KHRoaXMucmVzb3VyY2VEaWdpdHMsIHRoaXMucmVzb3VyY2VzVG90YWwudG9TdHJpbmcoKSksXG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIGFzIHN0YWNrIGV2ZW50IGFuZCB1cGRhdGUgdGhlIHByb2dyZXNzIHN0YXRlLlxuICAgKi9cbiAgcHVibGljIHByb2Nlc3MoZXZlbnQ6IFN0YWNrRXZlbnQpOiB2b2lkIHtcbiAgICBjb25zdCBzdGF0dXMgPSBldmVudC5SZXNvdXJjZVN0YXR1cztcbiAgICBpZiAoIXN0YXR1cyB8fCAhZXZlbnQuTG9naWNhbFJlc291cmNlSWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoc3RhdHVzLmVuZHNXaXRoKCdfQ09NUExFVEVfQ0xFQU5VUF9JTl9QUk9HUkVTUycpKSB7XG4gICAgICB0aGlzLnJlc291cmNlc0RvbmUrKztcbiAgICB9XG5cbiAgICBpZiAoc3RhdHVzLmVuZHNXaXRoKCdfQ09NUExFVEUnKSkge1xuICAgICAgY29uc3QgcHJldlN0YXRlID0gdGhpcy5yZXNvdXJjZXNQcmV2Q29tcGxldGVTdGF0ZVtldmVudC5Mb2dpY2FsUmVzb3VyY2VJZF07XG4gICAgICBpZiAoIXByZXZTdGF0ZSkge1xuICAgICAgICB0aGlzLnJlc291cmNlc0RvbmUrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElmIHdlIGNvbXBsZXRlZCB0aGlzIGJlZm9yZSBhbmQgd2UncmUgY29tcGxldGluZyBpdCBBR0FJTiwgbWVhbnMgd2UncmUgcm9sbGluZyBiYWNrLlxuICAgICAgICAvLyBQcm90ZWN0IGFnYWluc3Qgc2lsbHkgdW5kZXJmbG93LlxuICAgICAgICB0aGlzLnJlc291cmNlc0RvbmUtLTtcbiAgICAgICAgaWYgKHRoaXMucmVzb3VyY2VzRG9uZSA8IDApIHtcbiAgICAgICAgICB0aGlzLnJlc291cmNlc0RvbmUgPSAwO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLnJlc291cmNlc1ByZXZDb21wbGV0ZVN0YXRlW2V2ZW50LkxvZ2ljYWxSZXNvdXJjZUlkXSA9IHN0YXR1cztcbiAgICB9XG4gIH1cbn1cbiJdfQ==