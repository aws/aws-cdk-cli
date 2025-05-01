"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RollbackChoice = exports.StackStatus = void 0;
const client_cloudformation_1 = require("@aws-sdk/client-cloudformation");
/**
 * A utility class to inspect CloudFormation stack statuses.
 *
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-describing-stacks.html
 */
class StackStatus {
    name;
    reason;
    static fromStackDescription(description) {
        return new StackStatus(description.StackStatus, description.StackStatusReason);
    }
    constructor(name, reason) {
        this.name = name;
        this.reason = reason;
    }
    get isCreationFailure() {
        return this.name === client_cloudformation_1.StackStatus.ROLLBACK_COMPLETE || this.name === client_cloudformation_1.StackStatus.ROLLBACK_FAILED;
    }
    get isDeleted() {
        return this.name.startsWith('DELETE_');
    }
    get isFailure() {
        return this.name.endsWith('FAILED');
    }
    get isInProgress() {
        return this.name.endsWith('_IN_PROGRESS') && !this.isReviewInProgress;
    }
    get isReviewInProgress() {
        return this.name === client_cloudformation_1.StackStatus.REVIEW_IN_PROGRESS;
    }
    get isNotFound() {
        return this.name === 'NOT_FOUND';
    }
    get isDeploySuccess() {
        return (!this.isNotFound &&
            (this.name === client_cloudformation_1.StackStatus.CREATE_COMPLETE ||
                this.name === client_cloudformation_1.StackStatus.UPDATE_COMPLETE ||
                this.name === client_cloudformation_1.StackStatus.IMPORT_COMPLETE));
    }
    get isRollbackSuccess() {
        return this.name === client_cloudformation_1.StackStatus.ROLLBACK_COMPLETE || this.name === client_cloudformation_1.StackStatus.UPDATE_ROLLBACK_COMPLETE;
    }
    /**
     * Whether the stack is in a paused state due to `--no-rollback`.
     *
     * The possible actions here are retrying a new `--no-rollback` deployment, or initiating a rollback.
     */
    get rollbackChoice() {
        switch (this.name) {
            case client_cloudformation_1.StackStatus.CREATE_FAILED:
            case client_cloudformation_1.StackStatus.UPDATE_FAILED:
                return RollbackChoice.START_ROLLBACK;
            case client_cloudformation_1.StackStatus.UPDATE_ROLLBACK_FAILED:
                return RollbackChoice.CONTINUE_UPDATE_ROLLBACK;
            case client_cloudformation_1.StackStatus.ROLLBACK_FAILED:
                // Unfortunately there is no option to continue a failed rollback without
                // a stable target state.
                return RollbackChoice.ROLLBACK_FAILED;
            default:
                return RollbackChoice.NONE;
        }
    }
    get isRollbackable() {
        return [RollbackChoice.START_ROLLBACK, RollbackChoice.CONTINUE_UPDATE_ROLLBACK].includes(this.rollbackChoice);
    }
    toString() {
        return this.name + (this.reason ? ` (${this.reason})` : '');
    }
}
exports.StackStatus = StackStatus;
/**
 * Describe the current rollback options for this state
 */
var RollbackChoice;
(function (RollbackChoice) {
    RollbackChoice[RollbackChoice["START_ROLLBACK"] = 0] = "START_ROLLBACK";
    RollbackChoice[RollbackChoice["CONTINUE_UPDATE_ROLLBACK"] = 1] = "CONTINUE_UPDATE_ROLLBACK";
    /**
     * A sign that stack creation AND its rollback have failed.
     *
     * There is no way to recover from this, other than recreating the stack.
     */
    RollbackChoice[RollbackChoice["ROLLBACK_FAILED"] = 2] = "ROLLBACK_FAILED";
    RollbackChoice[RollbackChoice["NONE"] = 3] = "NONE";
})(RollbackChoice || (exports.RollbackChoice = RollbackChoice = {}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stc3RhdHVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9zdGFjay1ldmVudHMvc3RhY2stc3RhdHVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDBFQUF5RjtBQUV6Rjs7OztHQUlHO0FBQ0gsTUFBYSxXQUFXO0lBTUo7SUFDQTtJQU5YLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxXQUFrQjtRQUNuRCxPQUFPLElBQUksV0FBVyxDQUFDLFdBQVcsQ0FBQyxXQUFZLEVBQUUsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7SUFDbEYsQ0FBQztJQUVELFlBQ2tCLElBQVksRUFDWixNQUFlO1FBRGYsU0FBSSxHQUFKLElBQUksQ0FBUTtRQUNaLFdBQU0sR0FBTixNQUFNLENBQVM7SUFFakMsQ0FBQztJQUVELElBQUksaUJBQWlCO1FBQ25CLE9BQU8sSUFBSSxDQUFDLElBQUksS0FBSyxtQ0FBWSxDQUFDLGlCQUFpQixJQUFJLElBQUksQ0FBQyxJQUFJLEtBQUssbUNBQVksQ0FBQyxlQUFlLENBQUM7SUFDcEcsQ0FBQztJQUVELElBQUksU0FBUztRQUNYLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDekMsQ0FBQztJQUVELElBQUksU0FBUztRQUNYLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVELElBQUksWUFBWTtRQUNkLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUM7SUFDeEUsQ0FBQztJQUVELElBQUksa0JBQWtCO1FBQ3BCLE9BQU8sSUFBSSxDQUFDLElBQUksS0FBSyxtQ0FBWSxDQUFDLGtCQUFrQixDQUFDO0lBQ3ZELENBQUM7SUFFRCxJQUFJLFVBQVU7UUFDWixPQUFPLElBQUksQ0FBQyxJQUFJLEtBQUssV0FBVyxDQUFDO0lBQ25DLENBQUM7SUFFRCxJQUFJLGVBQWU7UUFDakIsT0FBTyxDQUNMLENBQUMsSUFBSSxDQUFDLFVBQVU7WUFDaEIsQ0FBQyxJQUFJLENBQUMsSUFBSSxLQUFLLG1DQUFZLENBQUMsZUFBZTtnQkFDekMsSUFBSSxDQUFDLElBQUksS0FBSyxtQ0FBWSxDQUFDLGVBQWU7Z0JBQzFDLElBQUksQ0FBQyxJQUFJLEtBQUssbUNBQVksQ0FBQyxlQUFlLENBQUMsQ0FDOUMsQ0FBQztJQUNKLENBQUM7SUFFRCxJQUFJLGlCQUFpQjtRQUNuQixPQUFPLElBQUksQ0FBQyxJQUFJLEtBQUssbUNBQVksQ0FBQyxpQkFBaUIsSUFBSSxJQUFJLENBQUMsSUFBSSxLQUFLLG1DQUFZLENBQUMsd0JBQXdCLENBQUM7SUFDN0csQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxJQUFJLGNBQWM7UUFDaEIsUUFBUSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDbEIsS0FBSyxtQ0FBWSxDQUFDLGFBQWEsQ0FBQztZQUNoQyxLQUFLLG1DQUFZLENBQUMsYUFBYTtnQkFDN0IsT0FBTyxjQUFjLENBQUMsY0FBYyxDQUFDO1lBQ3ZDLEtBQUssbUNBQVksQ0FBQyxzQkFBc0I7Z0JBQ3RDLE9BQU8sY0FBYyxDQUFDLHdCQUF3QixDQUFDO1lBQ2pELEtBQUssbUNBQVksQ0FBQyxlQUFlO2dCQUMvQix5RUFBeUU7Z0JBQ3pFLHlCQUF5QjtnQkFDekIsT0FBTyxjQUFjLENBQUMsZUFBZSxDQUFDO1lBQ3hDO2dCQUNFLE9BQU8sY0FBYyxDQUFDLElBQUksQ0FBQztRQUMvQixDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksY0FBYztRQUNoQixPQUFPLENBQUMsY0FBYyxDQUFDLGNBQWMsRUFBRSxjQUFjLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBQ2hILENBQUM7SUFFTSxRQUFRO1FBQ2IsT0FBTyxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQzlELENBQUM7Q0FDRjtBQTVFRCxrQ0E0RUM7QUFFRDs7R0FFRztBQUNILElBQVksY0FVWDtBQVZELFdBQVksY0FBYztJQUN4Qix1RUFBYyxDQUFBO0lBQ2QsMkZBQXdCLENBQUE7SUFDeEI7Ozs7T0FJRztJQUNILHlFQUFlLENBQUE7SUFDZixtREFBSSxDQUFBO0FBQ04sQ0FBQyxFQVZXLGNBQWMsOEJBQWQsY0FBYyxRQVV6QiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHR5cGUgU3RhY2ssIFN0YWNrU3RhdHVzIGFzIF9TdGFja1N0YXR1cyB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZGZvcm1hdGlvbic7XG5cbi8qKlxuICogQSB1dGlsaXR5IGNsYXNzIHRvIGluc3BlY3QgQ2xvdWRGb3JtYXRpb24gc3RhY2sgc3RhdHVzZXMuXG4gKlxuICogQHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTQ2xvdWRGb3JtYXRpb24vbGF0ZXN0L1VzZXJHdWlkZS91c2luZy1jZm4tZGVzY3JpYmluZy1zdGFja3MuaHRtbFxuICovXG5leHBvcnQgY2xhc3MgU3RhY2tTdGF0dXMge1xuICBwdWJsaWMgc3RhdGljIGZyb21TdGFja0Rlc2NyaXB0aW9uKGRlc2NyaXB0aW9uOiBTdGFjaykge1xuICAgIHJldHVybiBuZXcgU3RhY2tTdGF0dXMoZGVzY3JpcHRpb24uU3RhY2tTdGF0dXMhLCBkZXNjcmlwdGlvbi5TdGFja1N0YXR1c1JlYXNvbik7XG4gIH1cblxuICBjb25zdHJ1Y3RvcihcbiAgICBwdWJsaWMgcmVhZG9ubHkgbmFtZTogc3RyaW5nLFxuICAgIHB1YmxpYyByZWFkb25seSByZWFzb24/OiBzdHJpbmcsXG4gICkge1xuICB9XG5cbiAgZ2V0IGlzQ3JlYXRpb25GYWlsdXJlKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLm5hbWUgPT09IF9TdGFja1N0YXR1cy5ST0xMQkFDS19DT01QTEVURSB8fCB0aGlzLm5hbWUgPT09IF9TdGFja1N0YXR1cy5ST0xMQkFDS19GQUlMRUQ7XG4gIH1cblxuICBnZXQgaXNEZWxldGVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLm5hbWUuc3RhcnRzV2l0aCgnREVMRVRFXycpO1xuICB9XG5cbiAgZ2V0IGlzRmFpbHVyZSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5uYW1lLmVuZHNXaXRoKCdGQUlMRUQnKTtcbiAgfVxuXG4gIGdldCBpc0luUHJvZ3Jlc3MoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMubmFtZS5lbmRzV2l0aCgnX0lOX1BST0dSRVNTJykgJiYgIXRoaXMuaXNSZXZpZXdJblByb2dyZXNzO1xuICB9XG5cbiAgZ2V0IGlzUmV2aWV3SW5Qcm9ncmVzcygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5uYW1lID09PSBfU3RhY2tTdGF0dXMuUkVWSUVXX0lOX1BST0dSRVNTO1xuICB9XG5cbiAgZ2V0IGlzTm90Rm91bmQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMubmFtZSA9PT0gJ05PVF9GT1VORCc7XG4gIH1cblxuICBnZXQgaXNEZXBsb3lTdWNjZXNzKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAoXG4gICAgICAhdGhpcy5pc05vdEZvdW5kICYmXG4gICAgICAodGhpcy5uYW1lID09PSBfU3RhY2tTdGF0dXMuQ1JFQVRFX0NPTVBMRVRFIHx8XG4gICAgICAgIHRoaXMubmFtZSA9PT0gX1N0YWNrU3RhdHVzLlVQREFURV9DT01QTEVURSB8fFxuICAgICAgICB0aGlzLm5hbWUgPT09IF9TdGFja1N0YXR1cy5JTVBPUlRfQ09NUExFVEUpXG4gICAgKTtcbiAgfVxuXG4gIGdldCBpc1JvbGxiYWNrU3VjY2VzcygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5uYW1lID09PSBfU3RhY2tTdGF0dXMuUk9MTEJBQ0tfQ09NUExFVEUgfHwgdGhpcy5uYW1lID09PSBfU3RhY2tTdGF0dXMuVVBEQVRFX1JPTExCQUNLX0NPTVBMRVRFO1xuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHN0YWNrIGlzIGluIGEgcGF1c2VkIHN0YXRlIGR1ZSB0byBgLS1uby1yb2xsYmFja2AuXG4gICAqXG4gICAqIFRoZSBwb3NzaWJsZSBhY3Rpb25zIGhlcmUgYXJlIHJldHJ5aW5nIGEgbmV3IGAtLW5vLXJvbGxiYWNrYCBkZXBsb3ltZW50LCBvciBpbml0aWF0aW5nIGEgcm9sbGJhY2suXG4gICAqL1xuICBnZXQgcm9sbGJhY2tDaG9pY2UoKTogUm9sbGJhY2tDaG9pY2Uge1xuICAgIHN3aXRjaCAodGhpcy5uYW1lKSB7XG4gICAgICBjYXNlIF9TdGFja1N0YXR1cy5DUkVBVEVfRkFJTEVEOlxuICAgICAgY2FzZSBfU3RhY2tTdGF0dXMuVVBEQVRFX0ZBSUxFRDpcbiAgICAgICAgcmV0dXJuIFJvbGxiYWNrQ2hvaWNlLlNUQVJUX1JPTExCQUNLO1xuICAgICAgY2FzZSBfU3RhY2tTdGF0dXMuVVBEQVRFX1JPTExCQUNLX0ZBSUxFRDpcbiAgICAgICAgcmV0dXJuIFJvbGxiYWNrQ2hvaWNlLkNPTlRJTlVFX1VQREFURV9ST0xMQkFDSztcbiAgICAgIGNhc2UgX1N0YWNrU3RhdHVzLlJPTExCQUNLX0ZBSUxFRDpcbiAgICAgICAgLy8gVW5mb3J0dW5hdGVseSB0aGVyZSBpcyBubyBvcHRpb24gdG8gY29udGludWUgYSBmYWlsZWQgcm9sbGJhY2sgd2l0aG91dFxuICAgICAgICAvLyBhIHN0YWJsZSB0YXJnZXQgc3RhdGUuXG4gICAgICAgIHJldHVybiBSb2xsYmFja0Nob2ljZS5ST0xMQkFDS19GQUlMRUQ7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gUm9sbGJhY2tDaG9pY2UuTk9ORTtcbiAgICB9XG4gIH1cblxuICBnZXQgaXNSb2xsYmFja2FibGUoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIFtSb2xsYmFja0Nob2ljZS5TVEFSVF9ST0xMQkFDSywgUm9sbGJhY2tDaG9pY2UuQ09OVElOVUVfVVBEQVRFX1JPTExCQUNLXS5pbmNsdWRlcyh0aGlzLnJvbGxiYWNrQ2hvaWNlKTtcbiAgfVxuXG4gIHB1YmxpYyB0b1N0cmluZygpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLm5hbWUgKyAodGhpcy5yZWFzb24gPyBgICgke3RoaXMucmVhc29ufSlgIDogJycpO1xuICB9XG59XG5cbi8qKlxuICogRGVzY3JpYmUgdGhlIGN1cnJlbnQgcm9sbGJhY2sgb3B0aW9ucyBmb3IgdGhpcyBzdGF0ZVxuICovXG5leHBvcnQgZW51bSBSb2xsYmFja0Nob2ljZSB7XG4gIFNUQVJUX1JPTExCQUNLLFxuICBDT05USU5VRV9VUERBVEVfUk9MTEJBQ0ssXG4gIC8qKlxuICAgKiBBIHNpZ24gdGhhdCBzdGFjayBjcmVhdGlvbiBBTkQgaXRzIHJvbGxiYWNrIGhhdmUgZmFpbGVkLlxuICAgKlxuICAgKiBUaGVyZSBpcyBubyB3YXkgdG8gcmVjb3ZlciBmcm9tIHRoaXMsIG90aGVyIHRoYW4gcmVjcmVhdGluZyB0aGUgc3RhY2suXG4gICAqL1xuICBST0xMQkFDS19GQUlMRUQsXG4gIE5PTkUsXG59XG4iXX0=