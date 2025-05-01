"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IoHelper = void 0;
exports.asIoHelper = asIoHelper;
const span_1 = require("./span");
/**
 * A class containing helper tools to interact with IoHost
 */
class IoHelper {
    static fromIoHost(ioHost, action) {
        return new IoHelper(ioHost, action);
    }
    ioHost;
    action;
    constructor(ioHost, action) {
        this.ioHost = ioHost;
        this.action = action;
    }
    /**
     * Forward a message to the IoHost, while injection the current action
     */
    notify(msg) {
        return this.ioHost.notify({
            ...msg,
            action: this.action,
        });
    }
    /**
     * Forward a request to the IoHost, while injection the current action
     */
    requestResponse(msg) {
        return this.ioHost.requestResponse({
            ...msg,
            action: this.action,
        });
    }
    /**
     * Create a new marker from a given registry entry
     */
    span(definition) {
        return new span_1.SpanMaker(this, definition);
    }
}
exports.IoHelper = IoHelper;
/**
 * Wraps an IoHost and creates an IoHelper from it
 */
function asIoHelper(ioHost, action) {
    return IoHelper.fromIoHost(ioHost, action);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW8taGVscGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2FwaS9pby9wcml2YXRlL2lvLWhlbHBlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUF3REEsZ0NBRUM7QUF0REQsaUNBQW1DO0FBS25DOztHQUVHO0FBQ0gsTUFBYSxRQUFRO0lBQ1osTUFBTSxDQUFDLFVBQVUsQ0FBQyxNQUFlLEVBQUUsTUFBcUI7UUFDN0QsT0FBTyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVnQixNQUFNLENBQVU7SUFDaEIsTUFBTSxDQUFnQjtJQUV2QyxZQUFvQixNQUFlLEVBQUUsTUFBcUI7UUFDeEQsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0ksTUFBTSxDQUFDLEdBQStCO1FBQzNDLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUM7WUFDeEIsR0FBRyxHQUFHO1lBQ04sTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1NBQ3BCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNJLGVBQWUsQ0FBTyxHQUE0QjtRQUN2RCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDO1lBQ2pDLEdBQUcsR0FBRztZQUNOLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtTQUNwQixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSSxJQUFJLENBQXNDLFVBQWdDO1FBQy9FLE9BQU8sSUFBSSxnQkFBUyxDQUFDLElBQUksRUFBRSxVQUFVLENBQUMsQ0FBQztJQUN6QyxDQUFDO0NBQ0Y7QUF2Q0QsNEJBdUNDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixVQUFVLENBQUMsTUFBZSxFQUFFLE1BQXFCO0lBQy9ELE9BQU8sUUFBUSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDN0MsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgSUlvSG9zdCB9IGZyb20gJy4uL2lvLWhvc3QnO1xuaW1wb3J0IHR5cGUgeyBJb01lc3NhZ2UsIElvUmVxdWVzdCB9IGZyb20gJy4uL2lvLW1lc3NhZ2UnO1xuaW1wb3J0IHR5cGUgeyBUb29sa2l0QWN0aW9uIH0gZnJvbSAnLi4vdG9vbGtpdC1hY3Rpb24nO1xuaW1wb3J0IHR5cGUgeyBTcGFuRW5kLCBTcGFuRGVmaW5pdGlvbiB9IGZyb20gJy4vc3Bhbic7XG5pbXBvcnQgeyBTcGFuTWFrZXIgfSBmcm9tICcuL3NwYW4nO1xuXG5leHBvcnQgdHlwZSBBY3Rpb25MZXNzTWVzc2FnZTxUPiA9IE9taXQ8SW9NZXNzYWdlPFQ+LCAnYWN0aW9uJz47XG5leHBvcnQgdHlwZSBBY3Rpb25MZXNzUmVxdWVzdDxULCBVPiA9IE9taXQ8SW9SZXF1ZXN0PFQsIFU+LCAnYWN0aW9uJz47XG5cbi8qKlxuICogQSBjbGFzcyBjb250YWluaW5nIGhlbHBlciB0b29scyB0byBpbnRlcmFjdCB3aXRoIElvSG9zdFxuICovXG5leHBvcnQgY2xhc3MgSW9IZWxwZXIgaW1wbGVtZW50cyBJSW9Ib3N0IHtcbiAgcHVibGljIHN0YXRpYyBmcm9tSW9Ib3N0KGlvSG9zdDogSUlvSG9zdCwgYWN0aW9uOiBUb29sa2l0QWN0aW9uKSB7XG4gICAgcmV0dXJuIG5ldyBJb0hlbHBlcihpb0hvc3QsIGFjdGlvbik7XG4gIH1cblxuICBwcml2YXRlIHJlYWRvbmx5IGlvSG9zdDogSUlvSG9zdDtcbiAgcHJpdmF0ZSByZWFkb25seSBhY3Rpb246IFRvb2xraXRBY3Rpb247XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3Rvcihpb0hvc3Q6IElJb0hvc3QsIGFjdGlvbjogVG9vbGtpdEFjdGlvbikge1xuICAgIHRoaXMuaW9Ib3N0ID0gaW9Ib3N0O1xuICAgIHRoaXMuYWN0aW9uID0gYWN0aW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIEZvcndhcmQgYSBtZXNzYWdlIHRvIHRoZSBJb0hvc3QsIHdoaWxlIGluamVjdGlvbiB0aGUgY3VycmVudCBhY3Rpb25cbiAgICovXG4gIHB1YmxpYyBub3RpZnkobXNnOiBBY3Rpb25MZXNzTWVzc2FnZTx1bmtub3duPik6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiB0aGlzLmlvSG9zdC5ub3RpZnkoe1xuICAgICAgLi4ubXNnLFxuICAgICAgYWN0aW9uOiB0aGlzLmFjdGlvbixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3J3YXJkIGEgcmVxdWVzdCB0byB0aGUgSW9Ib3N0LCB3aGlsZSBpbmplY3Rpb24gdGhlIGN1cnJlbnQgYWN0aW9uXG4gICAqL1xuICBwdWJsaWMgcmVxdWVzdFJlc3BvbnNlPFQsIFU+KG1zZzogQWN0aW9uTGVzc1JlcXVlc3Q8VCwgVT4pOiBQcm9taXNlPFU+IHtcbiAgICByZXR1cm4gdGhpcy5pb0hvc3QucmVxdWVzdFJlc3BvbnNlKHtcbiAgICAgIC4uLm1zZyxcbiAgICAgIGFjdGlvbjogdGhpcy5hY3Rpb24sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgbmV3IG1hcmtlciBmcm9tIGEgZ2l2ZW4gcmVnaXN0cnkgZW50cnlcbiAgICovXG4gIHB1YmxpYyBzcGFuPFMgZXh0ZW5kcyBvYmplY3QsIEUgZXh0ZW5kcyBTcGFuRW5kPihkZWZpbml0aW9uOiBTcGFuRGVmaW5pdGlvbjxTLCBFPikge1xuICAgIHJldHVybiBuZXcgU3Bhbk1ha2VyKHRoaXMsIGRlZmluaXRpb24pO1xuICB9XG59XG5cbi8qKlxuICogV3JhcHMgYW4gSW9Ib3N0IGFuZCBjcmVhdGVzIGFuIElvSGVscGVyIGZyb20gaXRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzSW9IZWxwZXIoaW9Ib3N0OiBJSW9Ib3N0LCBhY3Rpb246IFRvb2xraXRBY3Rpb24pOiBJb0hlbHBlciB7XG4gIHJldHVybiBJb0hlbHBlci5mcm9tSW9Ib3N0KGlvSG9zdCwgYWN0aW9uKTtcbn1cbiJdfQ==