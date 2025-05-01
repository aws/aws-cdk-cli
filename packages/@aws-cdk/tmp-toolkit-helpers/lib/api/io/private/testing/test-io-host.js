"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestIoHost = void 0;
const require_approval_1 = require("../../../require-approval");
const io_helper_1 = require("../io-helper");
const level_priority_1 = require("../level-priority");
/**
 * A test implementation of IIoHost that does nothing but can be spied on.
 *
 * Includes a level to filter out irrelevant messages, defaults to `info`.
 *
 * Optionally set an approval level for code `CDK_TOOLKIT_I5060`.
 *
 * # How to use
 *
 * Configure and reset the `notifySpy` and `requestSpy` members as you would any
 * mock function.
 */
class TestIoHost {
    level;
    notifySpy;
    requestSpy;
    requireDeployApproval = require_approval_1.RequireApproval.NEVER;
    constructor(level = 'info') {
        this.level = level;
        this.notifySpy = jest.fn();
        this.requestSpy = jest.fn();
    }
    asHelper(action = 'synth') {
        return (0, io_helper_1.asIoHelper)(this, action);
    }
    async notify(msg) {
        if ((0, level_priority_1.isMessageRelevantForLevel)(msg, this.level)) {
            this.notifySpy(msg);
        }
    }
    async requestResponse(msg) {
        if ((0, level_priority_1.isMessageRelevantForLevel)(msg, this.level) && this.needsApproval(msg)) {
            this.requestSpy(msg);
        }
        return msg.defaultResponse;
    }
    needsApproval(msg) {
        // Return true if the code is unrelated to approval
        if (!['CDK_TOOLKIT_I5060'].includes(msg.code)) {
            return true;
        }
        switch (this.requireDeployApproval) {
            case require_approval_1.RequireApproval.NEVER:
                return false;
            case require_approval_1.RequireApproval.ANY_CHANGE:
                return true;
            case require_approval_1.RequireApproval.BROADENING:
                return msg.data?.permissionChangeType === 'broadening';
            default:
                return true;
        }
    }
}
exports.TestIoHost = TestIoHost;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1pby1ob3N0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2FwaS9pby9wcml2YXRlL3Rlc3RpbmcvdGVzdC1pby1ob3N0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLGdFQUE0RDtBQUk1RCw0Q0FBMEM7QUFDMUMsc0RBQThEO0FBRTlEOzs7Ozs7Ozs7OztHQVdHO0FBQ0gsTUFBYSxVQUFVO0lBTUY7SUFMSCxTQUFTLENBQTJCO0lBQ3BDLFVBQVUsQ0FBMkI7SUFFOUMscUJBQXFCLEdBQUcsa0NBQWUsQ0FBQyxLQUFLLENBQUM7SUFFckQsWUFBbUIsUUFBd0IsTUFBTTtRQUE5QixVQUFLLEdBQUwsS0FBSyxDQUF5QjtRQUMvQyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztRQUMzQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztJQUM5QixDQUFDO0lBRU0sUUFBUSxDQUFDLE1BQU0sR0FBRyxPQUFPO1FBQzlCLE9BQU8sSUFBQSxzQkFBVSxFQUFDLElBQUksRUFBRSxNQUFhLENBQUMsQ0FBQztJQUN6QyxDQUFDO0lBRU0sS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUF1QjtRQUN6QyxJQUFJLElBQUEsMENBQXlCLEVBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQy9DLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdEIsQ0FBQztJQUNILENBQUM7SUFFTSxLQUFLLENBQUMsZUFBZSxDQUFPLEdBQW9CO1FBQ3JELElBQUksSUFBQSwwQ0FBeUIsRUFBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMxRSxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZCLENBQUM7UUFDRCxPQUFPLEdBQUcsQ0FBQyxlQUFlLENBQUM7SUFDN0IsQ0FBQztJQUVPLGFBQWEsQ0FBQyxHQUF3QjtRQUM1QyxtREFBbUQ7UUFDbkQsSUFBSSxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDOUMsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsUUFBUSxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUNuQyxLQUFLLGtDQUFlLENBQUMsS0FBSztnQkFDeEIsT0FBTyxLQUFLLENBQUM7WUFDZixLQUFLLGtDQUFlLENBQUMsVUFBVTtnQkFDN0IsT0FBTyxJQUFJLENBQUM7WUFDZCxLQUFLLGtDQUFlLENBQUMsVUFBVTtnQkFDN0IsT0FBTyxHQUFHLENBQUMsSUFBSSxFQUFFLG9CQUFvQixLQUFLLFlBQVksQ0FBQztZQUN6RDtnQkFDRSxPQUFPLElBQUksQ0FBQztRQUNoQixDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBN0NELGdDQTZDQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFJlcXVpcmVBcHByb3ZhbCB9IGZyb20gJy4uLy4uLy4uL3JlcXVpcmUtYXBwcm92YWwnO1xuaW1wb3J0IHR5cGUgeyBJSW9Ib3N0IH0gZnJvbSAnLi4vLi4vaW8taG9zdCc7XG5pbXBvcnQgdHlwZSB7IElvTWVzc2FnZSwgSW9NZXNzYWdlTGV2ZWwsIElvUmVxdWVzdCB9IGZyb20gJy4uLy4uL2lvLW1lc3NhZ2UnO1xuaW1wb3J0IHR5cGUgeyBJb0hlbHBlciB9IGZyb20gJy4uL2lvLWhlbHBlcic7XG5pbXBvcnQgeyBhc0lvSGVscGVyIH0gZnJvbSAnLi4vaW8taGVscGVyJztcbmltcG9ydCB7IGlzTWVzc2FnZVJlbGV2YW50Rm9yTGV2ZWwgfSBmcm9tICcuLi9sZXZlbC1wcmlvcml0eSc7XG5cbi8qKlxuICogQSB0ZXN0IGltcGxlbWVudGF0aW9uIG9mIElJb0hvc3QgdGhhdCBkb2VzIG5vdGhpbmcgYnV0IGNhbiBiZSBzcGllZCBvbi5cbiAqXG4gKiBJbmNsdWRlcyBhIGxldmVsIHRvIGZpbHRlciBvdXQgaXJyZWxldmFudCBtZXNzYWdlcywgZGVmYXVsdHMgdG8gYGluZm9gLlxuICpcbiAqIE9wdGlvbmFsbHkgc2V0IGFuIGFwcHJvdmFsIGxldmVsIGZvciBjb2RlIGBDREtfVE9PTEtJVF9JNTA2MGAuXG4gKlxuICogIyBIb3cgdG8gdXNlXG4gKlxuICogQ29uZmlndXJlIGFuZCByZXNldCB0aGUgYG5vdGlmeVNweWAgYW5kIGByZXF1ZXN0U3B5YCBtZW1iZXJzIGFzIHlvdSB3b3VsZCBhbnlcbiAqIG1vY2sgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBjbGFzcyBUZXN0SW9Ib3N0IGltcGxlbWVudHMgSUlvSG9zdCB7XG4gIHB1YmxpYyByZWFkb25seSBub3RpZnlTcHk6IGplc3QuTW9jazxhbnksIGFueSwgYW55PjtcbiAgcHVibGljIHJlYWRvbmx5IHJlcXVlc3RTcHk6IGplc3QuTW9jazxhbnksIGFueSwgYW55PjtcblxuICBwdWJsaWMgcmVxdWlyZURlcGxveUFwcHJvdmFsID0gUmVxdWlyZUFwcHJvdmFsLk5FVkVSO1xuXG4gIGNvbnN0cnVjdG9yKHB1YmxpYyBsZXZlbDogSW9NZXNzYWdlTGV2ZWwgPSAnaW5mbycpIHtcbiAgICB0aGlzLm5vdGlmeVNweSA9IGplc3QuZm4oKTtcbiAgICB0aGlzLnJlcXVlc3RTcHkgPSBqZXN0LmZuKCk7XG4gIH1cblxuICBwdWJsaWMgYXNIZWxwZXIoYWN0aW9uID0gJ3N5bnRoJyk6IElvSGVscGVyIHtcbiAgICByZXR1cm4gYXNJb0hlbHBlcih0aGlzLCBhY3Rpb24gYXMgYW55KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBub3RpZnkobXNnOiBJb01lc3NhZ2U8dW5rbm93bj4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoaXNNZXNzYWdlUmVsZXZhbnRGb3JMZXZlbChtc2csIHRoaXMubGV2ZWwpKSB7XG4gICAgICB0aGlzLm5vdGlmeVNweShtc2cpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyByZXF1ZXN0UmVzcG9uc2U8VCwgVT4obXNnOiBJb1JlcXVlc3Q8VCwgVT4pOiBQcm9taXNlPFU+IHtcbiAgICBpZiAoaXNNZXNzYWdlUmVsZXZhbnRGb3JMZXZlbChtc2csIHRoaXMubGV2ZWwpICYmIHRoaXMubmVlZHNBcHByb3ZhbChtc2cpKSB7XG4gICAgICB0aGlzLnJlcXVlc3RTcHkobXNnKTtcbiAgICB9XG4gICAgcmV0dXJuIG1zZy5kZWZhdWx0UmVzcG9uc2U7XG4gIH1cblxuICBwcml2YXRlIG5lZWRzQXBwcm92YWwobXNnOiBJb1JlcXVlc3Q8YW55LCBhbnk+KTogYm9vbGVhbiB7XG4gICAgLy8gUmV0dXJuIHRydWUgaWYgdGhlIGNvZGUgaXMgdW5yZWxhdGVkIHRvIGFwcHJvdmFsXG4gICAgaWYgKCFbJ0NES19UT09MS0lUX0k1MDYwJ10uaW5jbHVkZXMobXNnLmNvZGUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBzd2l0Y2ggKHRoaXMucmVxdWlyZURlcGxveUFwcHJvdmFsKSB7XG4gICAgICBjYXNlIFJlcXVpcmVBcHByb3ZhbC5ORVZFUjpcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgY2FzZSBSZXF1aXJlQXBwcm92YWwuQU5ZX0NIQU5HRTpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlIFJlcXVpcmVBcHByb3ZhbC5CUk9BREVOSU5HOlxuICAgICAgICByZXR1cm4gbXNnLmRhdGE/LnBlcm1pc3Npb25DaGFuZ2VUeXBlID09PSAnYnJvYWRlbmluZyc7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==