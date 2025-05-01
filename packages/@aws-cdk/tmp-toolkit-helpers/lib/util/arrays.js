"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flatMap = flatMap;
exports.flatten = flatten;
exports.partition = partition;
/**
 * Map a function over an array and concatenate the results
 */
function flatMap(xs, fn) {
    return flatten(xs.map(fn));
}
/**
 * Flatten a list of lists into a list of elements
 */
function flatten(xs) {
    return Array.prototype.concat.apply([], xs);
}
/**
 * Partition a collection by removing and returning all elements that match a predicate
 *
 * Note: the input collection is modified in-place!
 */
function partition(collection, pred) {
    const ret = [];
    let i = 0;
    while (i < collection.length) {
        if (pred(collection[i])) {
            ret.push(collection.splice(i, 1)[0]);
        }
        else {
            i++;
        }
    }
    return ret;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXJyYXlzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWwvYXJyYXlzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBR0EsMEJBRUM7QUFLRCwwQkFFQztBQU9ELDhCQVdDO0FBOUJEOztHQUVHO0FBQ0gsU0FBZ0IsT0FBTyxDQUFPLEVBQU8sRUFBRSxFQUE4QjtJQUNuRSxPQUFPLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDN0IsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsT0FBTyxDQUFJLEVBQVM7SUFDbEMsT0FBTyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQzlDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBZ0IsU0FBUyxDQUFJLFVBQWUsRUFBRSxJQUF1QjtJQUNuRSxNQUFNLEdBQUcsR0FBUSxFQUFFLENBQUM7SUFDcEIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ1YsT0FBTyxDQUFDLEdBQUcsVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQzdCLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDeEIsR0FBRyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7YUFBTSxDQUFDO1lBQ04sQ0FBQyxFQUFFLENBQUM7UUFDTixDQUFDO0lBQ0gsQ0FBQztJQUNELE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTWFwIGEgZnVuY3Rpb24gb3ZlciBhbiBhcnJheSBhbmQgY29uY2F0ZW5hdGUgdGhlIHJlc3VsdHNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZsYXRNYXA8VCwgVT4oeHM6IFRbXSwgZm46ICgoeDogVCwgaTogbnVtYmVyKSA9PiBVW10pKTogVVtdIHtcbiAgcmV0dXJuIGZsYXR0ZW4oeHMubWFwKGZuKSk7XG59XG5cbi8qKlxuICogRmxhdHRlbiBhIGxpc3Qgb2YgbGlzdHMgaW50byBhIGxpc3Qgb2YgZWxlbWVudHNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZsYXR0ZW48VD4oeHM6IFRbXVtdKTogVFtdIHtcbiAgcmV0dXJuIEFycmF5LnByb3RvdHlwZS5jb25jYXQuYXBwbHkoW10sIHhzKTtcbn1cblxuLyoqXG4gKiBQYXJ0aXRpb24gYSBjb2xsZWN0aW9uIGJ5IHJlbW92aW5nIGFuZCByZXR1cm5pbmcgYWxsIGVsZW1lbnRzIHRoYXQgbWF0Y2ggYSBwcmVkaWNhdGVcbiAqXG4gKiBOb3RlOiB0aGUgaW5wdXQgY29sbGVjdGlvbiBpcyBtb2RpZmllZCBpbi1wbGFjZSFcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnRpdGlvbjxUPihjb2xsZWN0aW9uOiBUW10sIHByZWQ6ICh4OiBUKSA9PiBib29sZWFuKTogVFtdIHtcbiAgY29uc3QgcmV0OiBUW10gPSBbXTtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IGNvbGxlY3Rpb24ubGVuZ3RoKSB7XG4gICAgaWYgKHByZWQoY29sbGVjdGlvbltpXSkpIHtcbiAgICAgIHJldC5wdXNoKGNvbGxlY3Rpb24uc3BsaWNlKGksIDEpWzBdKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaSsrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmV0O1xufVxuIl19