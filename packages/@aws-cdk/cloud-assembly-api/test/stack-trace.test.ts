import { DEFAULT_USER_CODE_FINDER, StackFrame, StackTrace } from '../lib';

describe('topUserFrame', () => {
  test('simple trace', () => {
    expect(new StackTrace([
      '...new Queue in aws-cdk-lib...',
      'myFunction (/path/to/project/myfile.ts:10:5)',
      '...jsii runtime...',
    ]).findAndParse(DEFAULT_USER_CODE_FINDER)).toEqual({
      fileName: '/path/to/project/myfile.ts',
      sourceLocation: '10:5',
      functionName: 'myFunction',
    });
  });

  test('jsii client trace', () => {
    expect(new StackTrace([
      '...aws-cdk-lib...',
      '(no user code in 10 frames, use --stack-trace-limit to capture more)',
      '<module> (/Users/otaviom/jsii/fubanga/app.py:28)',
    ]).findAndParse(DEFAULT_USER_CODE_FINDER)).toEqual({
      fileName: '/Users/otaviom/jsii/fubanga/app.py',
      sourceLocation: '28',
      functionName: '<module>',
    });
  });
});

test('prefer function alias over function name', () => {
  // The alias has more information and is more accurate
  const parsed = StackFrame.parse(
    'SomeClass.fruit [as banana] (/Users/otaviom/jsii/fubanga/app.ts:28)',
  );

  expect(parsed).toEqual({
    fileName: '/Users/otaviom/jsii/fubanga/app.ts',
    sourceLocation: '28',
    functionName: 'SomeClass.banana',
  });
});
