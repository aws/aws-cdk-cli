// Overrides for plugin:jest/recommended
export default {
  'jest/expect-expect': 'off',
  'jest/no-conditional-expect': 'off',
  'jest/no-done-callback': 'off', // Far too many of these in the codebase.
  'jest/no-standalone-expect': 'off', // nodeunitShim confuses this check.
  'jest/valid-expect': 'off', // expect from '@aws-cdk/assert' can take a second argument
  'jest/valid-title': 'off', // A little over-zealous with test('test foo') being an error.
  'jest/no-identical-title': 'off', // TEMPORARY - Disabling this until https://github.com/jest-community/eslint-plugin-jest/issues/836 is resolved
  'jest/no-disabled-tests': 'error', // Skipped tests are easily missed in PR reviews
  'jest/no-focused-tests': 'error', // Focused tests are easily missed in PR reviews
};
