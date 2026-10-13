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

describe('StackTrace', () => {
  test('fromNewlineSeparatedString splits a captured trace into frames', () => {
    const frame = StackTrace.fromNewlineSeparatedString(
      'Error: boom\n...aws-cdk-lib...\nmyFunction (/p/app.ts:3:7)',
    ).findFirstUserFrame();

    expect(frame).toMatchObject({ fileName: '/p/app.ts', sourceLocation: '3:7' });
  });

  test('returns undefined when no frame looks like user code', () => {
    // Nothing here has the " (...)" shape the default finder keys on.
    expect(new StackTrace(['...aws-cdk-lib...', 'at internal']).findFirstUserFrame()).toBeUndefined();
    expect(new StackTrace([]).findFirstUserFrame()).toBeUndefined();
  });

  test('honors a custom frame finder', () => {
    const onlyAppTs = { isInterestingFrame: (f: string) => f.includes('app.ts') };

    const frame = new StackTrace([
      'helper (/p/helper.ts:1:1)',
      'main (/p/app.ts:9:2)',
    ]).findAndParse(onlyAppTs);

    expect(frame!.fileName).toBe('/p/app.ts');
  });
});

describe('DEFAULT_USER_CODE_FINDER', () => {
  test.each([
    ['myFunction (/p/app.ts:1:1)', true],
    ['new MyStack (/p/app.ts:1:1)', true],
    ['...aws-cdk-lib...', false],
    // The redaction placeholder must not be mistaken for a frame; the '(' is
    // not preceded by a space.
    ['(no user code in 10 frames, use --stack-trace-limit to capture more)', false],
    ['/p/app.ts:1:1', false],
  ])('%s -> %s', (frame, interesting) => {
    expect(DEFAULT_USER_CODE_FINDER.isInterestingFrame(frame)).toBe(interesting);
  });
});

describe('StackFrame.lineLocation', () => {
  test('parses line and column', () => {
    const frame = StackFrame.parse('f (/p/app.ts:10:5)');

    expect(frame.lineLocation).toEqual({ line: 10, column: 5 });
    expect(frame.lineNumber).toBe(10);
    expect(frame.columnNumber).toBe(5);
  });

  test('leaves the column undefined when only a line is present', () => {
    // jsii-generated traces (e.g. Python) carry a line but no column.
    const frame = StackFrame.parse('<module> (/p/app.py:28)');

    expect(frame.lineLocation).toEqual({ line: 28, column: undefined });
    expect(frame.lineNumber).toBe(28);
    expect(frame.columnNumber).toBeUndefined();
  });

  test('is undefined when the frame carries no source location', () => {
    const frame = StackFrame.parse('someFunction ()');

    expect(frame.lineLocation).toBeUndefined();
    expect(frame.lineNumber).toBeUndefined();
    expect(frame.columnNumber).toBeUndefined();
  });
});

describe('StackFrame.parse', () => {
  test('renames Object.<anonymous> to <anonymous>', () => {
    expect(StackFrame.parse('Object.<anonymous> (/p/app.ts:1:2)').functionName).toBe('<anonymous>');
  });

  test('keeps a Windows drive letter in the file name', () => {
    // The file name itself contains ':', so only the trailing digit groups are
    // the source location.
    const frame = StackFrame.parse('f (C:\\proj\\app.ts:10:5)');

    expect(frame.fileName).toBe('C:\\proj\\app.ts');
    expect(frame.lineLocation).toEqual({ line: 10, column: 5 });
  });
});
