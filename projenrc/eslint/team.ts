// CDK team specific rules
// These are typically informed by past operational events
export default {
  // This can cause huge I/O performance hits
  '@cdklabs/promiseall-no-unbounded-parallelism': ['error'],

  // No more md5, will break in FIPS environments
  'no-restricted-syntax': [
    'error',
    {
      // Both qualified and unqualified calls
      selector: "CallExpression:matches([callee.name='createHash'], [callee.property.name='createHash']) Literal[value='md5']",
      message: 'Use the md5hash() function from the core library if you want md5',
    },
    {
      // Spawning through a shell is the one place command injection can happen.
      // The only sanctioned shell entry point is `runUserCommandLine` in the
      // subprocess tool (which carries its own eslint-disable); everything else
      // must spawn an argv array via `run`/`runSync`, which never touch a shell.
      //
      // Reject any `shell` property that is not statically `false`.
      selector: "Property:matches([key.name='shell'], [key.value='shell']):not([value.type='Literal'][value.value=false])",
      message: 'Do not enable the `shell` spawn option. Use `run`/`runSync` (argv, no shell) from the subprocess tool, or `runUserCommandLine` for a user-authored command line.',
    },
  ],
};
