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
export declare function getResultObj(jsonObject: any, identifier: string, propertiesToReturn: string[]): {
    [key: string]: any;
};
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
export declare function findJsonValue(jsonObject: any, path: string): any;
