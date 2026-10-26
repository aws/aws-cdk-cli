/**
 * Type branding
 *
 * This allows marking certain types as having gone through particular operations.
 *
 * Branded types can be used anywhere the base type is expected, but the base type
 * cannot be used where a branded type is expected; the values have to go through
 * a type assertion operation to confirm their brand.
 *
 * Usage:
 *
 * ```
 * type ValidatedString = Branded<string, 'PassedMyValidation'>;
 *
 * function validate(x: string): asserts x is ValidatedString {
 *   // ... throw an error if not
 * }
 *
 * function isValid(x: string): x is ValidatedString {
 *   // ... throw an error if not
 * }
 * ```
 */

// This construct purely happens at type checking time. There is no run-time impact.
// Hence, we never even have to construct values of this type.
declare const __brand: unique symbol;

export type Brand<B> = { [__brand]: B };
export type Branded<T, B> = T & Brand<B>;

export type NotBranded<T, B extends Branded<any, any>> = T extends B ? never : T;
