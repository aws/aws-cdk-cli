"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeIoHost = void 0;
/**
 * An implementation of `IIoHost` that records messages and lets you assert on what was logged
 *
 * It's like `TestIoHost`, but comes with a predefined implementation for `notify`
 * that appends all messages to an in-memory array, and comes with a helper function
 * `expectMessage()` to test for the existence of a function in that array.
 *
 * Has a public mock for `requestResponse` that you configure like any
 * other mock function.
 *
 * # How to use
 *
 * Either create a new instance of this class for every test, or call `clear()`
 * on it between runs.
 */
class FakeIoHost {
    messages = [];
    requestResponse;
    constructor() {
        this.clear();
    }
    clear() {
        this.messages.splice(0, this.messages.length);
        this.requestResponse = jest.fn().mockRejectedValue(new Error('requestResponse not mocked'));
    }
    async notify(msg) {
        this.messages.push(msg);
    }
    expectMessage(m) {
        expect(this.messages).toContainEqual(expect.objectContaining({
            ...m.level ? { level: m.level } : undefined,
            // Can be a partial string as well
            message: expect.stringContaining(m.containing),
        }));
    }
}
exports.FakeIoHost = FakeIoHost;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFrZS1pby1ob3N0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2FwaS9pby9wcml2YXRlL3Rlc3RpbmcvZmFrZS1pby1ob3N0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUdBOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBQ0gsTUFBYSxVQUFVO0lBQ2QsUUFBUSxHQUE4QixFQUFFLENBQUM7SUFDekMsZUFBZSxDQUE4QztJQUVwRTtRQUNFLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUNmLENBQUM7SUFFTSxLQUFLO1FBQ1YsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDOUMsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQyxDQUFDO0lBQzlGLENBQUM7SUFFTSxLQUFLLENBQUMsTUFBTSxDQUFDLEdBQXVCO1FBQ3pDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQzFCLENBQUM7SUFFTSxhQUFhLENBQUMsQ0FBaUQ7UUFDcEUsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDO1lBQzNELEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQzNDLGtDQUFrQztZQUNsQyxPQUFPLEVBQUUsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUM7U0FDL0MsQ0FBQyxDQUFDLENBQUM7SUFDTixDQUFDO0NBQ0Y7QUF4QkQsZ0NBd0JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBJSW9Ib3N0IH0gZnJvbSAnLi4vLi4vaW8taG9zdCc7XG5pbXBvcnQgdHlwZSB7IElvTWVzc2FnZSwgSW9NZXNzYWdlTGV2ZWwsIElvUmVxdWVzdCB9IGZyb20gJy4uLy4uL2lvLW1lc3NhZ2UnO1xuXG4vKipcbiAqIEFuIGltcGxlbWVudGF0aW9uIG9mIGBJSW9Ib3N0YCB0aGF0IHJlY29yZHMgbWVzc2FnZXMgYW5kIGxldHMgeW91IGFzc2VydCBvbiB3aGF0IHdhcyBsb2dnZWRcbiAqXG4gKiBJdCdzIGxpa2UgYFRlc3RJb0hvc3RgLCBidXQgY29tZXMgd2l0aCBhIHByZWRlZmluZWQgaW1wbGVtZW50YXRpb24gZm9yIGBub3RpZnlgXG4gKiB0aGF0IGFwcGVuZHMgYWxsIG1lc3NhZ2VzIHRvIGFuIGluLW1lbW9yeSBhcnJheSwgYW5kIGNvbWVzIHdpdGggYSBoZWxwZXIgZnVuY3Rpb25cbiAqIGBleHBlY3RNZXNzYWdlKClgIHRvIHRlc3QgZm9yIHRoZSBleGlzdGVuY2Ugb2YgYSBmdW5jdGlvbiBpbiB0aGF0IGFycmF5LlxuICpcbiAqIEhhcyBhIHB1YmxpYyBtb2NrIGZvciBgcmVxdWVzdFJlc3BvbnNlYCB0aGF0IHlvdSBjb25maWd1cmUgbGlrZSBhbnlcbiAqIG90aGVyIG1vY2sgZnVuY3Rpb24uXG4gKlxuICogIyBIb3cgdG8gdXNlXG4gKlxuICogRWl0aGVyIGNyZWF0ZSBhIG5ldyBpbnN0YW5jZSBvZiB0aGlzIGNsYXNzIGZvciBldmVyeSB0ZXN0LCBvciBjYWxsIGBjbGVhcigpYFxuICogb24gaXQgYmV0d2VlbiBydW5zLlxuICovXG5leHBvcnQgY2xhc3MgRmFrZUlvSG9zdCBpbXBsZW1lbnRzIElJb0hvc3Qge1xuICBwdWJsaWMgbWVzc2FnZXM6IEFycmF5PElvTWVzc2FnZTx1bmtub3duPj4gPSBbXTtcbiAgcHVibGljIHJlcXVlc3RSZXNwb25zZSE6IDxULCBVPihtc2c6IElvUmVxdWVzdDxULCBVPikgPT4gUHJvbWlzZTxVPjtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLmNsZWFyKCk7XG4gIH1cblxuICBwdWJsaWMgY2xlYXIoKSB7XG4gICAgdGhpcy5tZXNzYWdlcy5zcGxpY2UoMCwgdGhpcy5tZXNzYWdlcy5sZW5ndGgpO1xuICAgIHRoaXMucmVxdWVzdFJlc3BvbnNlID0gamVzdC5mbigpLm1vY2tSZWplY3RlZFZhbHVlKG5ldyBFcnJvcigncmVxdWVzdFJlc3BvbnNlIG5vdCBtb2NrZWQnKSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgbm90aWZ5KG1zZzogSW9NZXNzYWdlPHVua25vd24+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5tZXNzYWdlcy5wdXNoKG1zZyk7XG4gIH1cblxuICBwdWJsaWMgZXhwZWN0TWVzc2FnZShtOiB7IGNvbnRhaW5pbmc6IHN0cmluZzsgbGV2ZWw/OiBJb01lc3NhZ2VMZXZlbCB9KSB7XG4gICAgZXhwZWN0KHRoaXMubWVzc2FnZXMpLnRvQ29udGFpbkVxdWFsKGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgIC4uLm0ubGV2ZWwgPyB7IGxldmVsOiBtLmxldmVsIH0gOiB1bmRlZmluZWQsXG4gICAgICAvLyBDYW4gYmUgYSBwYXJ0aWFsIHN0cmluZyBhcyB3ZWxsXG4gICAgICBtZXNzYWdlOiBleHBlY3Quc3RyaW5nQ29udGFpbmluZyhtLmNvbnRhaW5pbmcpLFxuICAgIH0pKTtcbiAgfVxufVxuIl19