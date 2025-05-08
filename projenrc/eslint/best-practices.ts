// General coding best practices
export default {
  'no-throw-literal': ['error'], // Require Error objects everywhere
  'no-shadow': ['off'], // Cannot shadow names
  '@typescript-eslint/no-shadow': 'error', // Cannot shadow names in TS
  '@typescript-eslint/no-floating-promises': 'error', // One of the easiest mistakes to make
  'no-console': ['error'], // Don't leave log statements littering the premises!
  'dot-notation': ['error'], // Must use foo.bar instead of foo['bar'] if possible
  'no-bitwise': ['error'], // Are you sure | is not a typo for || ?
  'curly': ['error', 'multi-line', 'consistent'], // require curly braces for multiline control statements
  '@cdklabs/no-invalid-path': ['error'], // Prevent incorrect use of fs.path()
  '@typescript-eslint/unbound-method': 'error', // Unbound methods are a JavaScript footgun
  '@typescript-eslint/return-await': 'error', // Make sure that inside try/catch blocks, promises are 'return await'ed
};
