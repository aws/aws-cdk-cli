/**
 * Describe a value by its type only, for use in error messages about values we rejected.
 *
 * The value is never traversed: no properties are read, no keys are enumerated and no
 * prototype or constructor is consulted. Only the `typeof` operator is applied, so the
 * returned string can never contain data that came from the value itself.
 *
 * @param value - the rejected value to categorize
 * @returns the JavaScript type name, `'null'` for `null`, or `'unknown'` if the type could not be determined
 */
export function describeValueType(value: unknown): string {
  // Property access and key enumeration are deliberately avoided here: a rejected value may
  // hold plugin credentials, and traversing it can also trigger getters or proxy traps that
  // throw from inside an error path.
  try {
    if (value === null) {
      return 'null';
    }
    return typeof value;
  } catch {
    return 'unknown';
  }
}
