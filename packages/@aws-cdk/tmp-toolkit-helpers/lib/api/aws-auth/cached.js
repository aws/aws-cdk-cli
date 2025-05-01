"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cached = cached;
exports.cachedAsync = cachedAsync;
/**
 * Cache the result of a function on an object
 *
 * We could have used @decorators to make this nicer but we don't use them anywhere yet,
 * so let's keep it simple and readable.
 */
function cached(obj, sym, fn) {
    if (!(sym in obj)) {
        obj[sym] = fn();
    }
    return obj[sym];
}
/**
 * Like 'cached', but async
 */
async function cachedAsync(obj, sym, fn) {
    if (!(sym in obj)) {
        obj[sym] = await fn();
    }
    return obj[sym];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9hd3MtYXV0aC9jYWNoZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFNQSx3QkFLQztBQUtELGtDQUtDO0FBckJEOzs7OztHQUtHO0FBQ0gsU0FBZ0IsTUFBTSxDQUFzQixHQUFNLEVBQUUsR0FBVyxFQUFFLEVBQVc7SUFDMUUsSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakIsR0FBVyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFDRCxPQUFRLEdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUMzQixDQUFDO0FBRUQ7O0dBRUc7QUFDSSxLQUFLLFVBQVUsV0FBVyxDQUFzQixHQUFNLEVBQUUsR0FBVyxFQUFFLEVBQW9CO0lBQzlGLElBQUksQ0FBQyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pCLEdBQVcsQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFNLEVBQUUsRUFBRSxDQUFDO0lBQ2pDLENBQUM7SUFDRCxPQUFRLEdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUMzQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDYWNoZSB0aGUgcmVzdWx0IG9mIGEgZnVuY3Rpb24gb24gYW4gb2JqZWN0XG4gKlxuICogV2UgY291bGQgaGF2ZSB1c2VkIEBkZWNvcmF0b3JzIHRvIG1ha2UgdGhpcyBuaWNlciBidXQgd2UgZG9uJ3QgdXNlIHRoZW0gYW55d2hlcmUgeWV0LFxuICogc28gbGV0J3Mga2VlcCBpdCBzaW1wbGUgYW5kIHJlYWRhYmxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FjaGVkPEEgZXh0ZW5kcyBvYmplY3QsIEI+KG9iajogQSwgc3ltOiBzeW1ib2wsIGZuOiAoKSA9PiBCKTogQiB7XG4gIGlmICghKHN5bSBpbiBvYmopKSB7XG4gICAgKG9iaiBhcyBhbnkpW3N5bV0gPSBmbigpO1xuICB9XG4gIHJldHVybiAob2JqIGFzIGFueSlbc3ltXTtcbn1cblxuLyoqXG4gKiBMaWtlICdjYWNoZWQnLCBidXQgYXN5bmNcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNhY2hlZEFzeW5jPEEgZXh0ZW5kcyBvYmplY3QsIEI+KG9iajogQSwgc3ltOiBzeW1ib2wsIGZuOiAoKSA9PiBQcm9taXNlPEI+KTogUHJvbWlzZTxCPiB7XG4gIGlmICghKHN5bSBpbiBvYmopKSB7XG4gICAgKG9iaiBhcyBhbnkpW3N5bV0gPSBhd2FpdCBmbigpO1xuICB9XG4gIHJldHVybiAob2JqIGFzIGFueSlbc3ltXTtcbn1cbiJdfQ==