export default {
  'import/no-unresolved': ['error'], // Require all imported libraries actually resolve (!!required for import/no-extraneous-dependencies to work!!)
  'import/no-duplicates': 'error', // Cannot import from the same module twice (we prefer `import/no-duplicate` over `no-duplicate-imports` since the former can handle type imports)
  '@typescript-eslint/no-require-imports': 'error', // Require use of the `import { foo } from 'bar';` form instead of `import foo = require('bar');`
  '@typescript-eslint/consistent-type-imports': 'error', // Enforce consistent usage of type imports. This allows transpilers to drop imports without knowing the types of the dependencies
  'import/no-relative-packages': 'error', // prefer imports using packag names in monorepo over relative paths

  // Require an ordering on all imports
  'import/order': ['error', {
    groups: ['builtin', 'external'],
    alphabetize: { order: 'asc', caseInsensitive: true },
  }],

  // disallow import of deprecated punycode package
  'no-restricted-imports': [
    'error', {
      paths: [
        {
          name: 'punycode',
          message: 'Package \'punycode\' has to be imported with trailing slash, see warning in https://github.com/bestiejs/punycode.js#installation',
        },
      ],
      patterns: ['!punycode/'],
    },
  ],
};
