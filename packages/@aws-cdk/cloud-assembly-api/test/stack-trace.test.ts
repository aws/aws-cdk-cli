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

describe('renderCallStackJustMyCode', () => {
  const DIR_SYMBOL = Symbol.for('jsii.context.hostDirName');

  afterEach(() => {
    delete (global as any)[DIR_SYMBOL];
  });

  test('renders namespaced packages correctly', () => {
    const stack: Parameters<typeof renderCallStackJustMyCode>[0] = [
      {
        fileName: '/path/to/project/node_modules/aws-cdk-lib/core/lib/asset-staging.js',
        functionName: 'AssetStaging.bundle',
        sourceLocation: '2:512',
      },
      {
        fileName: '/path/to/project/node_modules/aws-cdk-lib/aws-lambda/lib/function.js',
        functionName: 'new Function2',
        sourceLocation: '1:16236',
      },
      {
        fileName: '/path/to/project/node_modules/aws-cdk-lib/core/lib/prop-injectable.js',
        functionName: 'new Function2',
        sourceLocation: '1:726',
      },
      {
        fileName:
          '/path/to/project/node_modules/@aws-cdk/aws-lambda-python-alpha/lib/function.ts',
        functionName: 'new PythonFunction',
        sourceLocation: '70:5',
      },
      {
        fileName:
          '/path/to/project/myfile.js',
        functionName: 'new PythonFunction',
        sourceLocation: '70:5',
      },
    ];

    expect(renderCallStackJustMyCode(stack, false)).toEqual([
      '...aws-cdk-lib, new PythonFunction in @aws-cdk/aws-lambda-python-alpha...',
      'new PythonFunction (/path/to/project/myfile.js:70:5)',
    ]);
  });

  test('hides decorator files', () => {
    const stack: Parameters<typeof renderCallStackJustMyCode>[0] = [
      {
        fileName: '/path/to/project/aws-cdk-lib/aws-s3/lib/bucket.js',
        functionName: 'new Bucket2',
        sourceLocation: '2:512',
      },
      {
        fileName: '/path/to/project/aws-cdk-lib/core/lib/prop-injectable.js',
        functionName: 'new Bucket2',
        sourceLocation: '2:512',
      },
      {
        fileName: '/path/to/project/aws-cdk-lib/aws-lambda/lib/private/no-box-stack-traces.js',
        functionName: 'new Bucket2',
        sourceLocation: '1:16236',
      },
      {
        fileName:
          '/path/to/project/myfile.js',
        functionName: 'main',
        sourceLocation: '70:5',
      },
    ];

    expect(renderCallStackJustMyCode(stack, false)).toEqual([
      'new Bucket2 (/path/to/project/aws-cdk-lib/aws-s3/lib/bucket.js:2:512)',
      'main (/path/to/project/myfile.js:70:5)',
    ]);
  });

  test('filters out jsii runtime frames identified by hostDirName', () => {
    (global as any)[DIR_SYMBOL] = '/private/var/folders/zv/tmpjph88goj/lib';

    const stack: Parameters<typeof renderCallStackJustMyCode>[0] = [
      {
        fileName: '/path/to/project/node_modules/aws-cdk-lib/aws-sqs/lib/queue.js',
        functionName: 'new Queue',
        sourceLocation: '2:512',
      },
      {
        fileName: '/private/var/folders/zv/tmpjph88goj/lib/program.js',
        functionName: 'Kernel._Kernel_create',
        sourceLocation: '1:61224',
      },
      {
        fileName: '/private/var/folders/zv/tmpjph88goj/lib/program.js',
        functionName: 'Kernel.create',
        sourceLocation: '1:51955',
      },
      {
        fileName: '/private/var/folders/zv/tmpjph88goj/lib/program.js',
        functionName: 'KernelHost.processRequest',
        sourceLocation: '1:212180',
      },
      {
        fileName: '/private/var/folders/zv/tmpjph88goj/lib/program.js',
        functionName: 'KernelHost.run',
        sourceLocation: '1:211164',
      },
      {
        fileName: '/private/var/folders/zv/tmpjph88goj/lib/program.js',
        functionName: 'Immediate._onImmediate',
        sourceLocation: '1:211208',
      },
    ];

    expect(renderCallStackJustMyCode(stack, false)).toEqual([
      '...aws-cdk-lib, jsii runtime...',
      expect.stringContaining('use --stack-trace-limit to capture more'),
    ]);
  });

  test('filters jsii runtime frames between user code and external trace', () => {
    (global as any)[DIR_SYMBOL] = '/private/var/folders/zv/tmpjph88goj/lib';

    const stack: Parameters<typeof renderCallStackJustMyCode>[0] = [
      {
        fileName: '/path/to/project/node_modules/aws-cdk-lib/aws-sqs/lib/queue.js',
        functionName: 'new Queue',
        sourceLocation: '2:512',
      },
      {
        fileName: '/path/to/project/myfile.ts',
        functionName: 'myFunction',
        sourceLocation: '10:5',
      },
      {
        fileName: '/private/var/folders/zv/tmpjph88goj/lib/program.js',
        functionName: 'Kernel._Kernel_create',
        sourceLocation: '1:61224',
      },
      {
        fileName: '/private/var/folders/zv/tmpjph88goj/lib/program.js',
        functionName: 'KernelHost.run',
        sourceLocation: '1:211164',
      },
    ];

    expect(renderCallStackJustMyCode(stack, false)).toEqual([
      '...new Queue in aws-cdk-lib...',
      'myFunction (/path/to/project/myfile.ts:10:5)',
      '...jsii runtime...',
    ]);
  });

  test('does not filter user bundled code (e.g. esbuild output)', () => {
    const stack: Parameters<typeof renderCallStackJustMyCode>[0] = [
      {
        fileName: '/path/to/project/dist/bundle.js',
        functionName: 'MyStack.constructor',
        sourceLocation: '1:84320',
      },
      {
        fileName: '/path/to/project/dist/bundle.js',
        functionName: 'createApp',
        sourceLocation: '1:91000',
      },
    ];

    expect(renderCallStackJustMyCode(stack, false)).toEqual([
      'MyStack.constructor (/path/to/project/dist/bundle.js:1:84320)',
      'createApp (/path/to/project/dist/bundle.js:1:91000)',
    ]);
  });

  test('adds a hint if there are not enough stack frames to see Just My Code', () => {
    const stack: Parameters<typeof renderCallStackJustMyCode>[0] = [
      {
        fileName: '/path/to/project/node_modules/aws-cdk-lib/core/lib/asset-staging.js',
        functionName: 'AssetStaging.bundle',
        sourceLocation: '2:512',
      },
      {
        fileName: '/path/to/project/node_modules/aws-cdk-lib/aws-lambda/lib/function.js',
        functionName: 'new Function2',
        sourceLocation: '1:16236',
      },
      {
        fileName: '/path/to/project/node_modules/aws-cdk-lib/core/lib/prop-injectable.js',
        functionName: 'new Function2',
        sourceLocation: '1:726',
      },
      {
        fileName:
          '/path/to/project/node_modules/@aws-cdk/aws-lambda-python-alpha/lib/function.ts',
        functionName: 'new PythonFunction',
        sourceLocation: '70:5',
      },
    ];

    expect(renderCallStackJustMyCode(stack, false)).toEqual([
      '...aws-cdk-lib, @aws-cdk/aws-lambda-python-alpha...',
      expect.stringContaining('use --stack-trace-limit to capture more'),
    ]);
  });
});

interface Frame {
  fileName: string;
  functionName: string;
  sourceLocation: string;
}

function renderCallStackJustMyCode(stack: Frame[], indent = true): string[] {
  const trace = new StackTrace(stack.map(f => `${f.functionName} (${f.fileName}:${f.sourceLocation})`));
  return trace.renderJustMyCode(indent);
}
