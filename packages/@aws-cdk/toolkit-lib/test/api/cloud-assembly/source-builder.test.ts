import { ToolkitError } from '../../../lib';
import { Toolkit } from '../../../lib/toolkit';
import { appFixture, builderFixture, cdkOutFixture, TestIoHost } from '../../_helpers';

// these tests often run a bit longer than the default
jest.setTimeout(10_000);

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
});

describe('fromAssemblyBuilder', () => {
  test('defaults', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    const assembly = await cx.produce();

    // THEN
    expect(assembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);
  });

  test('can provide context', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'external-context', {
      'externally-provided-bucket-name': 'amzn-s3-demo-bucket',
    });
    const assembly = await cx.produce();
    const stack = assembly.getStackByName('Stack1').template;

    // THEN
    expect(JSON.stringify(stack)).toContain('amzn-s3-demo-bucket');
  });

  test('errors are wrapped as AssemblyError', async () => {
    // GIVEN
    const cx = await toolkit.fromAssemblyBuilder(() => {
      throw new Error('a wild error appeared');
    });

    // WHEN
    try {
      await cx.produce();
    } catch (err: any) {
      // THEN
      expect(ToolkitError.isAssemblyError(err)).toBe(true);
      expect(err.cause?.message).toContain('a wild error appeared');
    }
  });
});

describe('fromCdkApp', () => {
  test('defaults', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'two-empty-stacks');
    const assembly = await cx.produce();

    // THEN
    expect(assembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);
  });

  test('can provide context', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'external-context', {
      'externally-provided-bucket-name': 'amzn-s3-demo-bucket',
    });
    const assembly = await cx.produce();
    const stack = assembly.getStackByName('Stack1').template;

    // THEN
    expect(JSON.stringify(stack)).toContain('amzn-s3-demo-bucket');
  });

  test('will capture error output', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'validation-error');
    try {
      await cx.produce();
    } catch {
      // we are just interested in the output for this test
    }

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      code: 'CDK_ASSEMBLY_E1002',
      message: expect.stringContaining('ValidationError'),
    }));
  });

  test('will capture all output', async () => {
    // WHEN
    const cx = await appFixture(toolkit, 'console-output');
    await cx.produce();

    // THEN
    ['one', 'two', 'three', 'four'].forEach((line) => {
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        level: 'info',
        code: 'CDK_ASSEMBLY_I1001',
        message: `line ${line}`,
      }));
    });
  });
});

describe('fromAssemblyDirectory', () => {
  test('defaults', async () => {
    // WHEN
    const cx = await cdkOutFixture(toolkit, 'two-empty-stacks');
    const assembly = await cx.produce();

    // THEN
    expect(assembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1', 'Stack2']);
  });

  test('validates manifest version', async () => {
    // WHEN
    const cx = await cdkOutFixture(toolkit, 'manifest-from-the-future');

    // THEN
    await expect(() => cx.produce()).rejects.toThrow('This AWS CDK Toolkit is not compatible with the AWS CDK library used by your application');
  });

  test('can disable manifest version validation', async () => {
    // WHEN
    const cx = await cdkOutFixture(toolkit, 'manifest-from-the-future', {
      loadAssemblyOptions: {
        checkVersion: false,
      },
    });
    const assembly = await cx.produce();

    // THEN
    expect(assembly.stacksRecursively.map(s => s.hierarchicalId)).toEqual(['Stack1']);
  });
});
