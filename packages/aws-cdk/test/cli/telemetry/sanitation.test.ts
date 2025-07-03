import { sanitizeCommandLineArguments, sanitizeContext } from '../../../lib/cli/telemetry/sanitation';

describe(sanitizeContext, () => {
  test('boolean values are kept', () => {
    const context = { key1: true, key2: false };
    expect(sanitizeContext(context)).toEqual(context);
  });

  test('string boolean values are booleanized', () => {
    const context = { key1: 'true', key2: 'false' };
    expect(sanitizeContext(context)).toEqual({ key1: true, key2: false});
  });

  test('strings values are booleanized', () => {
    const context = { key1: 'fancy-value' };
    expect(sanitizeContext(context)).toEqual({ key1: true });
  });

  test('list values are booleanized', () => {
    const context = { key1: [true, false] };
    expect(sanitizeContext(context)).toEqual({ key1: true });
  });
});

describe(sanitizeCommandLineArguments, () => {
  test('arguments are sanitized', () => {
    const argv = {
      _: ['deploy'],
      STACKS: ['MyStack'],
    };
    expect(sanitizeCommandLineArguments(argv)).toEqual({
      path: ['deploy', '$STACK1'],
      parameters: {},
    });
  });

  test('multiple arguments are sanitized with a counter', () => {
    const argv = {
      _: ['deploy'],
      STACKS: ['MyStackA', 'MyStackB'],
    };
    expect(sanitizeCommandLineArguments(argv)).toEqual({
      path: ['deploy', '$STACK1', '$STACK2'],
      parameters: {},
    });
  });

  test('boolean and number options are recorded', () => {
    const argv = {
      _: ['deploy'],
      STACKS: ['MyStack'],
      all: true,
      concurrency: 4
    };
    expect(sanitizeCommandLineArguments(argv)).toEqual({
      path: ['deploy', '$STACK1'],
      parameters: { all: true, concurrency: 4 },
    });
  });

  test('unknown options are dropped', () => {
    const argv = {
      _: ['deploy'],
      STACKS: ['MyStack'],
      all: true,
      a: true,
      blah: false,
    };
    expect(sanitizeCommandLineArguments(argv)).toEqual({
      path: ['deploy', '$STACK1'],
      parameters: { all: true },
    });
  });

  test('non-boolean options are redacted', () => {
    const argv = {
      _: ['deploy'],
      STACKS: ['MyStack'],
      ['require-approval']: 'broadening',
      ['build-exclude']: ['something'],
    };
    expect(sanitizeCommandLineArguments(argv)).toEqual({
      path: ['deploy', '$STACK1'],
      parameters: { 'require-approval': '<redacted>', 'build-exclude': '<redacted>' },
    });
  });

});