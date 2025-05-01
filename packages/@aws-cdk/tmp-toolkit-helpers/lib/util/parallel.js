"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parallelPromises = parallelPromises;
/**
 * Run a number of promise generators with max parallelism
 *
 * Order is not maintained between the input and output.
 */
async function parallelPromises(n, promises) {
    const ret = new Array();
    let count = 0;
    let error;
    const queue = [...promises];
    return new Promise((ok, ko) => {
        tick();
        function tick() {
            if (count === 0 && error) {
                ko(error);
                return;
            }
            if (count === 0 && queue.length === 0) {
                ok(ret);
                return;
            }
            while (count < n && queue.length > 0 && !error) {
                const next = queue.shift();
                if (next !== undefined) {
                    start(next);
                }
            }
        }
        function start(fn) {
            count += 1;
            fn()
                .then((result) => {
                ret.push(result);
            })
                .catch((e) => {
                error = e;
            })
                .finally(() => {
                count -= 1;
                tick();
            });
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGFyYWxsZWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvdXRpbC9wYXJhbGxlbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUtBLDRDQTBDQztBQS9DRDs7OztHQUlHO0FBQ0ksS0FBSyxVQUFVLGdCQUFnQixDQUFJLENBQVMsRUFBRSxRQUFpQztJQUNwRixNQUFNLEdBQUcsR0FBRyxJQUFJLEtBQUssRUFBSyxDQUFDO0lBQzNCLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztJQUNkLElBQUksS0FBd0IsQ0FBQztJQUM3QixNQUFNLEtBQUssR0FBRyxDQUFDLEdBQUcsUUFBUSxDQUFDLENBQUM7SUFFNUIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRTtRQUM1QixJQUFJLEVBQUUsQ0FBQztRQUVQLFNBQVMsSUFBSTtZQUNYLElBQUksS0FBSyxLQUFLLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQztnQkFDekIsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUNWLE9BQU87WUFDVCxDQUFDO1lBQ0QsSUFBSSxLQUFLLEtBQUssQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3RDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDUixPQUFPO1lBQ1QsQ0FBQztZQUVELE9BQU8sS0FBSyxHQUFHLENBQUMsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO2dCQUMvQyxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUM7Z0JBQzNCLElBQUksSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUN2QixLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ2QsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsU0FBUyxLQUFLLENBQUMsRUFBb0I7WUFDakMsS0FBSyxJQUFJLENBQUMsQ0FBQztZQUNYLEVBQUUsRUFBRTtpQkFDRCxJQUFJLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQkFDZixHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ25CLENBQUMsQ0FBQztpQkFDRCxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRTtnQkFDWCxLQUFLLEdBQUcsQ0FBQyxDQUFDO1lBQ1osQ0FBQyxDQUFDO2lCQUNELE9BQU8sQ0FBQyxHQUFHLEVBQUU7Z0JBQ1osS0FBSyxJQUFJLENBQUMsQ0FBQztnQkFDWCxJQUFJLEVBQUUsQ0FBQztZQUNULENBQUMsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztJQUNILENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUnVuIGEgbnVtYmVyIG9mIHByb21pc2UgZ2VuZXJhdG9ycyB3aXRoIG1heCBwYXJhbGxlbGlzbVxuICpcbiAqIE9yZGVyIGlzIG5vdCBtYWludGFpbmVkIGJldHdlZW4gdGhlIGlucHV0IGFuZCBvdXRwdXQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYXJhbGxlbFByb21pc2VzPEE+KG46IG51bWJlciwgcHJvbWlzZXM6IEFycmF5PCgpID0+IFByb21pc2U8QT4+KTogUHJvbWlzZTxBcnJheTxBPj4ge1xuICBjb25zdCByZXQgPSBuZXcgQXJyYXk8QT4oKTtcbiAgbGV0IGNvdW50ID0gMDtcbiAgbGV0IGVycm9yOiBFcnJvciB8IHVuZGVmaW5lZDtcbiAgY29uc3QgcXVldWUgPSBbLi4ucHJvbWlzZXNdO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgob2ssIGtvKSA9PiB7XG4gICAgdGljaygpO1xuXG4gICAgZnVuY3Rpb24gdGljaygpIHtcbiAgICAgIGlmIChjb3VudCA9PT0gMCAmJiBlcnJvcikge1xuICAgICAgICBrbyhlcnJvcik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChjb3VudCA9PT0gMCAmJiBxdWV1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgb2socmV0KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB3aGlsZSAoY291bnQgPCBuICYmIHF1ZXVlLmxlbmd0aCA+IDAgJiYgIWVycm9yKSB7XG4gICAgICAgIGNvbnN0IG5leHQgPSBxdWV1ZS5zaGlmdCgpO1xuICAgICAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgc3RhcnQobmV4dCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdGFydChmbjogKCkgPT4gUHJvbWlzZTxBPikge1xuICAgICAgY291bnQgKz0gMTtcbiAgICAgIGZuKClcbiAgICAgICAgLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIHJldC5wdXNoKHJlc3VsdCk7XG4gICAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoZSkgPT4ge1xuICAgICAgICAgIGVycm9yID0gZTtcbiAgICAgICAgfSlcbiAgICAgICAgLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICAgIGNvdW50IC09IDE7XG4gICAgICAgICAgdGljaygpO1xuICAgICAgICB9KTtcbiAgICB9XG4gIH0pO1xufVxuIl19