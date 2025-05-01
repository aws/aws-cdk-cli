"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResultObj = getResultObj;
exports.findJsonValue = findJsonValue;
/**
 * This gets the values of the jsonObject at the paths specified in propertiesToReturn.
 *
 * For example, jsonObject = {
 *   key1: 'abc',
 *   key2: {
 *     foo: 'qwerty',
 *     bar: 'data',
 *   }
 * }
 *
 * propertiesToReturn = ['key1', 'key2.foo'];
 *
 * The returned object is:
 *
 * ```
 * {
 *   key1: 'abc',
 *   'key2.foo': 'qwerty',
 *   Identifier: identifier
 * }
 * ```
 */
function getResultObj(jsonObject, identifier, propertiesToReturn) {
    const propsObj = {};
    propertiesToReturn.forEach((propName) => {
        Object.assign(propsObj, { [propName]: findJsonValue(jsonObject, propName) });
    });
    Object.assign(propsObj, { ['Identifier']: identifier });
    return propsObj;
}
/**
 * This finds the value of the jsonObject at the path.  Path is delimited by '.'.
 *
 * For example, jsonObject = {
 *   key1: 'abc',
 *   key2: {
 *     foo: 'qwerty',
 *     bar: 'data',
 *   }
 * }
 *
 * If path is 'key1', then it will return 'abc'.
 * If path is 'key2.foo', then it will return 'qwerty'.
 * If path is 'key2', then it will return the object:
 * {
 *   foo: 'qwerty',
 *   bar: 'data',
 * }
 *
 * If the path is not found, an Error will be thrown stating which token is missing.
 */
function findJsonValue(jsonObject, path) {
    const paths = path.split('.');
    let obj = jsonObject;
    paths.forEach(p => {
        obj = obj[p];
        if (obj === undefined) {
            throw new TypeError(`Cannot read field ${path}. ${p} is not found.`);
        }
    });
    return obj;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoianNvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlsL2pzb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUF1QkEsb0NBT0M7QUF1QkQsc0NBVUM7QUEvREQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQkc7QUFDSCxTQUFnQixZQUFZLENBQUMsVUFBZSxFQUFFLFVBQWtCLEVBQUUsa0JBQTRCO0lBQzVGLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQztJQUNwQixrQkFBa0IsQ0FBQyxPQUFPLENBQUMsQ0FBQyxRQUFRLEVBQUUsRUFBRTtRQUN0QyxNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsYUFBYSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDL0UsQ0FBQyxDQUFDLENBQUM7SUFDSCxNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUMsWUFBWSxDQUFDLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztJQUN4RCxPQUFPLFFBQVEsQ0FBQztBQUNsQixDQUFDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBb0JHO0FBQ0gsU0FBZ0IsYUFBYSxDQUFDLFVBQWUsRUFBRSxJQUFZO0lBQ3pELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDOUIsSUFBSSxHQUFHLEdBQUcsVUFBVSxDQUFDO0lBQ3JCLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUU7UUFDaEIsR0FBRyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNiLElBQUksR0FBRyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sSUFBSSxTQUFTLENBQUMscUJBQXFCLElBQUksS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7UUFDdkUsQ0FBQztJQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxHQUFHLENBQUM7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUaGlzIGdldHMgdGhlIHZhbHVlcyBvZiB0aGUganNvbk9iamVjdCBhdCB0aGUgcGF0aHMgc3BlY2lmaWVkIGluIHByb3BlcnRpZXNUb1JldHVybi5cbiAqXG4gKiBGb3IgZXhhbXBsZSwganNvbk9iamVjdCA9IHtcbiAqICAga2V5MTogJ2FiYycsXG4gKiAgIGtleTI6IHtcbiAqICAgICBmb286ICdxd2VydHknLFxuICogICAgIGJhcjogJ2RhdGEnLFxuICogICB9XG4gKiB9XG4gKlxuICogcHJvcGVydGllc1RvUmV0dXJuID0gWydrZXkxJywgJ2tleTIuZm9vJ107XG4gKlxuICogVGhlIHJldHVybmVkIG9iamVjdCBpczpcbiAqXG4gKiBgYGBcbiAqIHtcbiAqICAga2V5MTogJ2FiYycsXG4gKiAgICdrZXkyLmZvbyc6ICdxd2VydHknLFxuICogICBJZGVudGlmaWVyOiBpZGVudGlmaWVyXG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldFJlc3VsdE9iaihqc29uT2JqZWN0OiBhbnksIGlkZW50aWZpZXI6IHN0cmluZywgcHJvcGVydGllc1RvUmV0dXJuOiBzdHJpbmdbXSk6IHtba2V5OiBzdHJpbmddOiBhbnl9IHtcbiAgY29uc3QgcHJvcHNPYmogPSB7fTtcbiAgcHJvcGVydGllc1RvUmV0dXJuLmZvckVhY2goKHByb3BOYW1lKSA9PiB7XG4gICAgT2JqZWN0LmFzc2lnbihwcm9wc09iaiwgeyBbcHJvcE5hbWVdOiBmaW5kSnNvblZhbHVlKGpzb25PYmplY3QsIHByb3BOYW1lKSB9KTtcbiAgfSk7XG4gIE9iamVjdC5hc3NpZ24ocHJvcHNPYmosIHsgWydJZGVudGlmaWVyJ106IGlkZW50aWZpZXIgfSk7XG4gIHJldHVybiBwcm9wc09iajtcbn1cblxuLyoqXG4gKiBUaGlzIGZpbmRzIHRoZSB2YWx1ZSBvZiB0aGUganNvbk9iamVjdCBhdCB0aGUgcGF0aC4gIFBhdGggaXMgZGVsaW1pdGVkIGJ5ICcuJy5cbiAqXG4gKiBGb3IgZXhhbXBsZSwganNvbk9iamVjdCA9IHtcbiAqICAga2V5MTogJ2FiYycsXG4gKiAgIGtleTI6IHtcbiAqICAgICBmb286ICdxd2VydHknLFxuICogICAgIGJhcjogJ2RhdGEnLFxuICogICB9XG4gKiB9XG4gKlxuICogSWYgcGF0aCBpcyAna2V5MScsIHRoZW4gaXQgd2lsbCByZXR1cm4gJ2FiYycuXG4gKiBJZiBwYXRoIGlzICdrZXkyLmZvbycsIHRoZW4gaXQgd2lsbCByZXR1cm4gJ3F3ZXJ0eScuXG4gKiBJZiBwYXRoIGlzICdrZXkyJywgdGhlbiBpdCB3aWxsIHJldHVybiB0aGUgb2JqZWN0OlxuICoge1xuICogICBmb286ICdxd2VydHknLFxuICogICBiYXI6ICdkYXRhJyxcbiAqIH1cbiAqXG4gKiBJZiB0aGUgcGF0aCBpcyBub3QgZm91bmQsIGFuIEVycm9yIHdpbGwgYmUgdGhyb3duIHN0YXRpbmcgd2hpY2ggdG9rZW4gaXMgbWlzc2luZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbmRKc29uVmFsdWUoanNvbk9iamVjdDogYW55LCBwYXRoOiBzdHJpbmcpOiBhbnkge1xuICBjb25zdCBwYXRocyA9IHBhdGguc3BsaXQoJy4nKTtcbiAgbGV0IG9iaiA9IGpzb25PYmplY3Q7XG4gIHBhdGhzLmZvckVhY2gocCA9PiB7XG4gICAgb2JqID0gb2JqW3BdO1xuICAgIGlmIChvYmogPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgQ2Fubm90IHJlYWQgZmllbGQgJHtwYXRofS4gJHtwfSBpcyBub3QgZm91bmQuYCk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG9iajtcbn1cbiJdfQ==