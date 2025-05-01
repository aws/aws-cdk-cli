"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StringWriteStream = void 0;
const node_stream_1 = require("node:stream");
/*
 * Custom writable stream that collects text into a string buffer.
 * Used on classes that take in and directly write to a stream, but
 * we intend to capture the output rather than print.
 */
class StringWriteStream extends node_stream_1.Writable {
    buffer = [];
    constructor() {
        super();
    }
    _write(chunk, _encoding, callback) {
        this.buffer.push(chunk.toString());
        callback();
    }
    toString() {
        return this.buffer.join('');
    }
}
exports.StringWriteStream = StringWriteStream;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RyZWFtcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9hcGkvc3RyZWFtcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FBdUM7QUFFdkM7Ozs7R0FJRztBQUNILE1BQWEsaUJBQWtCLFNBQVEsc0JBQVE7SUFDckMsTUFBTSxHQUFhLEVBQUUsQ0FBQztJQUU5QjtRQUNFLEtBQUssRUFBRSxDQUFDO0lBQ1YsQ0FBQztJQUVELE1BQU0sQ0FBQyxLQUFVLEVBQUUsU0FBaUIsRUFBRSxRQUF3QztRQUM1RSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUNuQyxRQUFRLEVBQUUsQ0FBQztJQUNiLENBQUM7SUFFRCxRQUFRO1FBQ04sT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUM5QixDQUFDO0NBQ0Y7QUFmRCw4Q0FlQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFdyaXRhYmxlIH0gZnJvbSAnbm9kZTpzdHJlYW0nO1xuXG4vKlxuICogQ3VzdG9tIHdyaXRhYmxlIHN0cmVhbSB0aGF0IGNvbGxlY3RzIHRleHQgaW50byBhIHN0cmluZyBidWZmZXIuXG4gKiBVc2VkIG9uIGNsYXNzZXMgdGhhdCB0YWtlIGluIGFuZCBkaXJlY3RseSB3cml0ZSB0byBhIHN0cmVhbSwgYnV0XG4gKiB3ZSBpbnRlbmQgdG8gY2FwdHVyZSB0aGUgb3V0cHV0IHJhdGhlciB0aGFuIHByaW50LlxuICovXG5leHBvcnQgY2xhc3MgU3RyaW5nV3JpdGVTdHJlYW0gZXh0ZW5kcyBXcml0YWJsZSB7XG4gIHByaXZhdGUgYnVmZmVyOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBfd3JpdGUoY2h1bms6IGFueSwgX2VuY29kaW5nOiBzdHJpbmcsIGNhbGxiYWNrOiAoZXJyb3I/OiBFcnJvciB8IG51bGwpID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLmJ1ZmZlci5wdXNoKGNodW5rLnRvU3RyaW5nKCkpO1xuICAgIGNhbGxiYWNrKCk7XG4gIH1cblxuICB0b1N0cmluZygpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlci5qb2luKCcnKTtcbiAgfVxufVxuIl19