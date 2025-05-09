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
  ],
};
