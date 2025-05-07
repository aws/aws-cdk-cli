export default {
  '@stylistic/indent': ['error', 2],
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
  '@stylistic/member-delimiter-style': ['error'], // require semicolon delimiter
  '@stylistic/comma-dangle': ['error', 'always-multiline'], // ensures clean diffs, see https://medium.com/@nikgraf/why-you-should-enforce-dangling-commas-for-multiline-statements-d034c98e36f8
  '@stylistic/no-extra-semi': ['error'], // no extra semicolons
  '@stylistic/curly-newline': ['error', 'always'], // improves the diff, COE action item
  '@stylistic/comma-spacing': ['error', { before: false, after: true }], // space after, no space before
  '@stylistic/no-multi-spaces': ['error', { ignoreEOLComments: false }], // no multi spaces
  '@stylistic/array-bracket-spacing': ['error', 'never'], // [1, 2, 3]
  '@stylistic/array-bracket-newline': ['error', 'consistent'], // enforce consistent line breaks between brackets
  '@stylistic/object-curly-spacing': ['error', 'always'], // { key: 'value' }
  '@stylistic/object-curly-newline': ['error', { multiline: true, consistent: true }], // enforce consistent line breaks between braces
  '@stylistic/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }], // enforce "same line" or "multiple line" on object properties
  '@stylistic/keyword-spacing': ['error'], // require a space before & after keywords
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }], // enforce one true brace style
  '@stylistic/space-before-blocks': 'error', // require space before blocks
  '@stylistic/eol-last': ['error', 'always'], // require a newline a the end of files
  '@stylistic/spaced-comment': ['error', 'always', { exceptions: ['/', '*'], markers: ['/'] }], // require a whitespace at the beginninng of each comment
  '@stylistic/padded-blocks': ['error', { classes: 'never', blocks: 'never', switches: 'never' }],
  '@stylistic/key-spacing': ['error'], // Required spacing in property declarations (copied from TSLint, defaults are good)
  '@stylistic/quote-props': ['error', 'consistent-as-needed'], // Don't unnecessarily quote properties
  '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }], // No multiple empty lines
  '@stylistic/no-trailing-spaces': ['error'], // Useless diff results
  '@stylistic/semi': ['error', 'always'], // Always require semicolons
  '@stylistic/max-len': ['error', { // Limit max line lengths
    code: 150,
    ignoreUrls: true, // Most common reason to disable it
    ignoreStrings: true, // These are not fantastic but necessary for error messages
    ignoreTemplateLiterals: true,
    ignoreComments: true,
    ignoreRegExpLiterals: true,
  }],
  '@typescript-eslint/member-ordering': ['error', { // Member ordering
    default: [
      'public-static-field',
      'public-static-method',
      'protected-static-field',
      'protected-static-method',
      'private-static-field',
      'private-static-method',

      'field',

      // Constructors
      'constructor', // = ["public-constructor", "protected-constructor", "private-constructor"]

      // Methods
      'method',
    ],
  }],
};
