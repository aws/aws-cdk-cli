import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import { Context } from '../../../lib/api/context';
import { IO } from '../../../lib/api-private';
import type { IoMessage, IoMessageLevel, IoRequest } from '../../../lib/cli/io-host';
import { CliIoHost, matchAny } from '../../../lib/cli/io-host';
import { CLI_PRIVATE_IO } from '../../../lib/cli/telemetry/messages';

let passThrough: PassThrough;

// Store original process.on
const originalProcessOn = process.on;

// Mock process.on to be a no-op function that returns process for chaining
process.on = jest.fn().mockImplementation(function () {
  return process;
}) as any;

const ioHost = CliIoHost.instance({
  logLevel: 'trace',
});

// Mess with the 'process' global so we can replace its 'process.stdin' member
global.process = { ...process };

describe('CliIoHost', () => {
  let mockStdout: jest.Mock;
  let mockStderr: jest.Mock;
  let defaultMessage: Omit<IoMessage<unknown>, 'data'>;

  beforeEach(() => {
    mockStdout = jest.fn();
    mockStderr = jest.fn();

    // Reset singleton state
    ioHost.isTTY = process.stdout.isTTY ?? false;
    ioHost.isCI = false;
    ioHost.currentAction = 'synth';
    ioHost.requireDeployApproval = RequireApproval.ANYCHANGE;
    (process as any).stdin = passThrough = new PassThrough();

    defaultMessage = {
      time: new Date('2024-01-01T12:00:00'),
      level: 'info',
      action: 'synth',
      code: 'CDK_TOOLKIT_I0001',
      message: 'test message',
    };

    jest.spyOn(process.stdout, 'write').mockImplementation((str: any, encoding?: any, cb?: any) => {
      mockStdout(str.toString());
      const callback = typeof encoding === 'function' ? encoding : cb;
      if (callback) callback();
      return true;
    });

    jest.spyOn(process.stderr, 'write').mockImplementation((str: any, encoding?: any, cb?: any) => {
      mockStderr(str.toString());
      const callback = typeof encoding === 'function' ? encoding : cb;
      if (callback) callback();
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    // Restore original process.on
    process.on = originalProcessOn;
  });

  describe('stream selection', () => {
    test('writes to stderr by default for non-error messages in non-CI mode', async () => {
      ioHost.isTTY = true;
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'test message',
      }));

      expect(mockStderr).toHaveBeenCalledWith(chalk.reset('test message') + '\n');
      expect(mockStdout).not.toHaveBeenCalled();
    });

    test('writes to stderr for error level with red color', async () => {
      ioHost.isTTY = true;
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'error',
        action: 'synth',
        code: 'CDK_TOOLKIT_E0001',
        message: 'error message',
      }));

      expect(mockStderr).toHaveBeenCalledWith(chalk.red('error message') + '\n');
      expect(mockStdout).not.toHaveBeenCalled();
    });

    test('writes to stdout for result level', async () => {
      ioHost.isTTY = true;
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'result',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'result message',
      }));

      expect(mockStdout).toHaveBeenCalledWith(chalk.reset('result message') + '\n');
      expect(mockStderr).not.toHaveBeenCalled();
    });
  });

  describe('notices stream selection', () => {
    const NOTICES_MSG: IoMessage<unknown> = plainMessage({
      time: new Date(),
      level: 'info',
      action: 'doctor',
      code: 'CDK_TOOLKIT_I0100',
      message: 'MESSAGE',
    });

    test('can send notices to stdout', async () => {
      ioHost.noticesDestination = 'stdout';
      await ioHost.notify(NOTICES_MSG);
      // THEN
      expect(mockStdout).toHaveBeenCalledWith(expect.stringContaining('MESSAGE'));
    });

    test('can send notices to stderr', async () => {
      ioHost.noticesDestination = 'stderr';
      await ioHost.notify(NOTICES_MSG);
      // THEN
      expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('MESSAGE'));
    });

    test('can drop notices', async () => {
      ioHost.noticesDestination = 'drop';
      await ioHost.notify(NOTICES_MSG);
      // THEN
      expect(mockStdout).not.toHaveBeenCalled();
      expect(mockStderr).not.toHaveBeenCalled();
    });
  });

  describe('message listeners', () => {
    const disposers: Array<() => void> = [];

    function track(dispose: () => void) {
      disposers.push(dispose);
      return dispose;
    }

    function listMessage(message = 'Stack-A\nStack-B'): IoMessage<unknown> {
      return plainMessage({
        time: new Date(),
        level: 'result',
        action: 'list',
        code: 'CDK_TOOLKIT_I2901',
        message,
      });
    }

    beforeEach(() => {
      ioHost.isTTY = false;
    });

    afterEach(() => {
      // Remove any listeners that did not remove themselves, to avoid leaking
      // into other tests that share the singleton io host.
      while (disposers.length > 0) {
        disposers.pop()!();
      }
    });

    test('on() invokes the observer for every matching message without changing output', async () => {
      const observed: string[] = [];
      track(ioHost.on(IO.CDK_TOOLKIT_I2901, (msg) => {
        observed.push(msg.message);
      }));

      await ioHost.notify(listMessage('first'));
      await ioHost.notify(listMessage('second'));

      // observer saw both, output is unchanged
      expect(observed).toEqual(['first', 'second']);
      expect(mockStdout).toHaveBeenCalledWith('first\n');
      expect(mockStdout).toHaveBeenCalledWith('second\n');
    });

    test('once() invokes the observer only for the first matching message', async () => {
      const observed: string[] = [];
      track(ioHost.once(IO.CDK_TOOLKIT_I2901, (msg) => {
        observed.push(msg.message);
      }));

      await ioHost.notify(listMessage('first'));
      await ioHost.notify(listMessage('second'));

      expect(observed).toEqual(['first']);
    });

    test('on() supports async listeners and awaits them before the message is processed', async () => {
      const order: string[] = [];
      track(ioHost.on(IO.CDK_TOOLKIT_I2901, async (msg) => {
        await new Promise((resolve) => setImmediate(resolve));
        order.push(`listener:${msg.message}`);
        return { message: `async:${msg.message}` };
      }));

      await ioHost.notify(listMessage('first'));
      order.push('after-notify');

      // notify() did not resolve until the async listener finished, and the
      // text it returned was applied before the message was written.
      expect(order).toEqual(['listener:first', 'after-notify']);
      expect(mockStdout).toHaveBeenCalledWith('async:first\n');
    });

    test('requestResponse() awaits an async listener that answers the request', async () => {
      track(ioHost.on(IO.CDK_TOOLKIT_I7010, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return { respond: true, preventDefault: true };
      }));

      const answer = await ioHost.requestResponse({
        time: new Date(),
        level: 'info',
        action: 'destroy',
        code: 'CDK_TOOLKIT_I7010',
        message: 'proceed?',
        defaultResponse: true,
        data: { motivation: 'because' },
      });

      expect(answer).toBe(true);
    });

    test('removeAllListeners() removes every user-registered listener', async () => {
      const observed: string[] = [];
      // Register via on() and once() and rewrite() — all user listeners.
      track(ioHost.on(IO.CDK_TOOLKIT_I2901, (msg) => {
        observed.push(msg.message);
      }));
      track(ioHost.rewrite(IO.CDK_TOOLKIT_I2901, (msg) => `rewritten:${msg.message}`));

      await ioHost.notify(listMessage('before'));
      ioHost.removeAllListeners();
      await ioHost.notify(listMessage('after'));

      // The on() listener stopped firing and the rewrite no longer applies.
      expect(observed).toEqual(['before']);
      expect(mockStdout).toHaveBeenCalledWith('after\n');
    });

    test('removeAllListeners() keeps the host internal stack-activity routing', async () => {
      // Clear all (user) listeners, then verify a stack-activity message is
      // still routed to the printer and suppressed — i.e. the internal listener
      // survived.
      ioHost.removeAllListeners();
      (ioHost as any).activityPrinter = undefined;
      const fakePrinter = { notify: jest.fn() };
      const makeSpy = jest.spyOn(ioHost as any, 'makeActivityPrinter').mockReturnValue(fakePrinter);

      const activity = plainMessage({
        time: new Date(),
        level: 'info',
        action: 'deploy',
        code: 'CDK_TOOLKIT_I5502',
        message: 'raw activity text',
      });
      await ioHost.notify(activity);

      expect(fakePrinter.notify).toHaveBeenCalledWith(activity);
      expect(mockStdout).not.toHaveBeenCalled();
      expect(mockStderr).not.toHaveBeenCalled();

      makeSpy.mockRestore();
    });

    test('on() accepts a maker `.is` type guard as the selector', async () => {
      const observed: string[] = [];
      track(ioHost.on(IO.CDK_TOOLKIT_I2901.is, (msg) => {
        observed.push(msg.message);
      }));

      await ioHost.notify(listMessage('matches'));
      // A message with a different code is not matched by the type guard.
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'other',
      }));

      expect(observed).toEqual(['matches']);
    });

    test('on() accepts an arbitrary predicate as the selector', async () => {
      const observed: string[] = [];
      // Match any message whose code is in the I29xx family.
      track(ioHost.on((msg) => (msg.code ?? '').startsWith('CDK_TOOLKIT_I29'), (msg) => {
        observed.push(msg.message);
      }));

      await ioHost.notify(listMessage('matches'));
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'nope',
      }));

      expect(observed).toEqual(['matches']);
    });

    test('a request maker `.is` predicate can answer a request', async () => {
      // The motivating example: pass IO.<code>.is as the selector for a request.
      track(ioHost.on(IO.CDK_TOOLKIT_I7010.is, () => ({ respond: true, preventDefault: true })));

      const answer = await ioHost.requestResponse({
        time: new Date(),
        level: 'info',
        action: 'destroy',
        code: 'CDK_TOOLKIT_I7010',
        message: 'proceed?',
        defaultResponse: false,
        data: { motivation: 'because' },
      });

      expect(answer).toBe(true);
    });

    test('on() with matchAny() fires for any of the given codes', async () => {
      const observed: string[] = [];
      track(ioHost.on(matchAny(IO.CDK_TOOLKIT_I2901, IO.CDK_TOOLKIT_I1000), (msg) => {
        observed.push(`${msg.code}:${msg.message}`);
      }));

      await ioHost.notify(listMessage('a'));
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_I1000',
        message: 'b',
      }));
      // A code not in the set is ignored.
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'c',
      }));

      expect(observed).toEqual(['CDK_TOOLKIT_I2901:a', 'CDK_TOOLKIT_I1000:b']);
    });

    test('rewrite() replaces the printed text for every matching message', async () => {
      track(ioHost.rewrite(IO.CDK_TOOLKIT_I2901, (msg) => `rewritten:${msg.message}`));

      await ioHost.notify(listMessage('first'));
      await ioHost.notify(listMessage('second'));

      expect(mockStdout).toHaveBeenCalledWith('rewritten:first\n');
      expect(mockStdout).toHaveBeenCalledWith('rewritten:second\n');
    });

    test('a rewrite fires once through a corked replay, not again on the replayed message', async () => {
      // Messages emitted while corked are buffered and later replayed through
      // notify() when the cork releases. Listeners must not run on that replay
      // (they already ran on the first pass), otherwise a rewrite would
      // re-transform its own output.
      let calls = 0;
      track(ioHost.rewrite(IO.CDK_TOOLKIT_I2901, (msg) => `rewritten:${++calls}:${msg.message}`));

      await ioHost.withCorkedLogging(async () => {
        await ioHost.notify(listMessage('first'));
      });

      expect(calls).toBe(1);
      expect(mockStdout).toHaveBeenCalledWith('rewritten:1:first\n');
      expect(mockStdout).not.toHaveBeenCalledWith('rewritten:2:rewritten:1:first\n');
    });

    test('rewriteOnce() replaces the text of only the first matching message', async () => {
      track(ioHost.rewriteOnce(IO.CDK_TOOLKIT_I2901, (msg) => `rewritten:${msg.message}`));

      await ioHost.notify(listMessage('first'));
      await ioHost.notify(listMessage('second'));

      expect(mockStdout).toHaveBeenCalledWith('rewritten:first\n');
      expect(mockStdout).toHaveBeenCalledWith('second\n');
    });

    test('rewrite() can also override the level, moving the message between streams', async () => {
      // A result-level message normally goes to stdout; rewriting it to info
      // (and changing the text) sends it to stderr in non-CI mode.
      track(ioHost.rewrite(IO.CDK_TOOLKIT_I2901, (msg) => `rewritten:${msg.message}`, 'info'));

      await ioHost.notify(listMessage('first'));

      expect(mockStderr).toHaveBeenCalledWith('rewritten:first\n');
      expect(mockStdout).not.toHaveBeenCalled();
    });

    test('on() can override only the level, leaving the text unchanged', async () => {
      track(ioHost.on(IO.CDK_TOOLKIT_I2901, () => ({ level: 'info' })));

      await ioHost.notify(listMessage('first'));

      // text unchanged, but routed to stderr because it is now info-level
      expect(mockStderr).toHaveBeenCalledWith('first\n');
      expect(mockStdout).not.toHaveBeenCalled();
    });

    test('on() can override the effective action', async () => {
      let actionSeenByLaterListener: string | undefined;
      let emittedAction: string | undefined;
      let effectiveAction: string | undefined;

      track(ioHost.on(IO.CDK_TOOLKIT_I2901, () => ({ action: 'metadata' })));
      track(ioHost.on(IO.CDK_TOOLKIT_I2901, (msg) => {
        actionSeenByLaterListener = msg.action;
      }));
      track(ioHost.observeMessages((observation) => {
        emittedAction = observation.emitted.action;
        effectiveAction = observation.effective.action;
      }));

      await ioHost.notify(listMessage('first'));

      expect(actionSeenByLaterListener).toBe('metadata');
      expect(emittedAction).toBe('list');
      expect(effectiveAction).toBe('metadata');
    });

    test('the returned dispose function removes the listener', async () => {
      const observed: string[] = [];
      const dispose = ioHost.on(IO.CDK_TOOLKIT_I2901, (msg) => {
        observed.push(msg.message);
      });

      await ioHost.notify(listMessage('before'));
      dispose();
      await ioHost.notify(listMessage('after'));

      expect(observed).toEqual(['before']);
    });

    test('listeners only fire for the registered message code', async () => {
      const observed: string[] = [];
      track(ioHost.on(IO.CDK_TOOLKIT_I2901, (msg) => {
        observed.push(msg.message);
      }));

      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'unrelated',
      }));

      expect(observed).toEqual([]);
    });

    test('listeners receive the typed message payload', async () => {
      let seenIds: string[] = [];
      track(ioHost.rewrite(IO.CDK_TOOLKIT_I2901, (msg) => {
        seenIds = msg.data.stacks.map(s => s.id);
        return seenIds.join(', ');
      }));

      await ioHost.notify({
        ...listMessage(),
        data: { stacks: [{ id: 'Stack-A' }, { id: 'Stack-B' }] as any },
      });

      expect(seenIds).toEqual(['Stack-A', 'Stack-B']);
      expect(mockStdout).toHaveBeenCalledWith('Stack-A, Stack-B\n');
    });

    test('on() updates the printed text when it returns { message }', async () => {
      track(ioHost.on(IO.CDK_TOOLKIT_I2901, (msg) => ({ message: `updated:${msg.message}` })));

      await ioHost.notify(listMessage('hello'));

      expect(mockStdout).toHaveBeenCalledWith('updated:hello\n');
    });

    test('on() prevents the default processing when it returns { preventDefault: true }', async () => {
      track(ioHost.on(IO.CDK_TOOLKIT_I2901, () => ({ preventDefault: true })));

      await ioHost.notify(listMessage('suppressed'));

      // default processing skipped: never written to any stream
      expect(mockStdout).not.toHaveBeenCalled();
      expect(mockStderr).not.toHaveBeenCalled();
    });

    test('disposing a listener twice is a no-op', async () => {
      const observed: string[] = [];
      const dispose = ioHost.on(IO.CDK_TOOLKIT_I2901, (msg) => {
        observed.push(msg.message);
      });

      dispose();
      dispose();
      await ioHost.notify(listMessage('after'));

      expect(observed).toEqual([]);
    });
  });

  describe('stack activity routing', () => {
    function activityMessage(code: string, message = 'raw activity text'): IoMessage<unknown> {
      return plainMessage({
        time: new Date(),
        level: 'info',
        action: 'deploy',
        code: code as any,
        message,
      });
    }

    beforeEach(() => {
      // Force the lazy-creation path for each test.
      (ioHost as any).activityPrinter = undefined;
    });

    test('routes a stack-activity message to the activity printer and consumes it', async () => {
      const fakePrinter = { notify: jest.fn() };
      const makeSpy = jest.spyOn(ioHost as any, 'makeActivityPrinter').mockReturnValue(fakePrinter);

      const msg = activityMessage('CDK_TOOLKIT_I5502');
      await ioHost.notify(msg);

      // lazily created the printer and forwarded the message to it
      expect(makeSpy).toHaveBeenCalledTimes(1);
      expect(fakePrinter.notify).toHaveBeenCalledWith(msg);
      // consumed: the raw message is not also written to a stream
      expect(mockStdout).not.toHaveBeenCalled();
      expect(mockStderr).not.toHaveBeenCalled();
    });

    test('reuses an existing activity printer for subsequent messages', async () => {
      const fakePrinter = { notify: jest.fn() };
      const makeSpy = jest.spyOn(ioHost as any, 'makeActivityPrinter').mockReturnValue(fakePrinter);

      await ioHost.notify(activityMessage('CDK_TOOLKIT_I5501', 'start'));
      await ioHost.notify(activityMessage('CDK_TOOLKIT_I5503', 'stop'));

      // created once, then reused
      expect(makeSpy).toHaveBeenCalledTimes(1);
      expect(fakePrinter.notify).toHaveBeenCalledTimes(2);
    });
  });

  describe('message formatting', () => {
    beforeEach(() => {
      ioHost.isTTY = true;
    });

    test('formats debug messages with timestamp', async () => {
      await ioHost.notify(plainMessage({
        ...defaultMessage,
        level: 'debug',
      }));

      expect(mockStderr).toHaveBeenCalledWith(`[12:00:00] ${chalk.gray('test message')}\n`);
    });

    test('formats trace messages with timestamp', async () => {
      await ioHost.notify(plainMessage({
        ...defaultMessage,
        level: 'trace',
      }));

      expect(mockStderr).toHaveBeenCalledWith(`[12:00:00] ${chalk.gray('test message')}\n`);
    });

    test('applies no styling when TTY is false', async () => {
      ioHost.isTTY = false;
      await ioHost.notify(plainMessage({
        ...defaultMessage,
      }));

      expect(mockStderr).toHaveBeenCalledWith('test message\n');
    });

    test.each([
      ['error', 'red', false],
      ['warn', 'yellow', false],
      ['info', 'reset', false],
      ['debug', 'gray', true],
      ['trace', 'gray', true],
    ] as Array<[IoMessageLevel, typeof chalk.ForegroundColor, boolean]>)('outputs %ss in %s color ', async (level, color, shouldAddTime) => {
      // Given
      const style = chalk[color];
      let expectedOutput = `${style('test message')}\n`;
      if (shouldAddTime) {
        expectedOutput = `[12:00:00] ${expectedOutput}`;
      }

      // When
      await ioHost.notify(plainMessage({
        ...defaultMessage,
        level,
      }));

      // Then
      expect(mockStderr).toHaveBeenCalledWith(expectedOutput);
      mockStdout.mockClear();
    });
  });

  describe('action handling', () => {
    test('sets and gets current action', () => {
      ioHost.currentAction = 'deploy';
      expect(ioHost.currentAction).toBe('deploy');
    });
  });

  describe('CI mode behavior', () => {
    beforeEach(() => {
      ioHost.isTTY = true;
      ioHost.isCI = true;
    });

    test('writes to stdout in CI mode when level is not error', async () => {
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_W0001',
        message: 'ci message',
      }));

      expect(mockStdout).toHaveBeenCalledWith(chalk.reset('ci message') + '\n');
      expect(mockStderr).not.toHaveBeenCalled();
    });

    test('writes to stderr for error level in CI mode', async () => {
      await ioHost.notify(plainMessage({
        time: new Date(),
        level: 'error',
        action: 'synth',
        code: 'CDK_TOOLKIT_E0001',
        message: 'ci error message',
      }));

      expect(mockStderr).toHaveBeenCalledWith(chalk.red('ci error message') + '\n');
      expect(mockStdout).not.toHaveBeenCalled();
    });
  });

  describe('timestamp handling', () => {
    beforeEach(() => {
      ioHost.isTTY = true;
    });

    test('includes timestamp for DEBUG level with gray color', async () => {
      const testDate = new Date('2024-01-01T12:34:56');
      await ioHost.notify(plainMessage({
        time: testDate,
        level: 'debug',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'debug message',
      }));

      expect(mockStderr).toHaveBeenCalledWith(`[12:34:56] ${chalk.gray('debug message')}\n`);
    });

    test('excludes timestamp for other levels but includes color', async () => {
      const testDate = new Date('2024-01-01T12:34:56');
      await ioHost.notify(plainMessage({
        time: testDate,
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'info message',
      }));

      expect(mockStderr).toHaveBeenCalledWith(chalk.reset('info message') + '\n');
    });
  });

  test('telemetry should not be instantiated with an invalid command', async () => {
    const telemetryIoHost = CliIoHost.instance({
      logLevel: 'trace',
    }, true);

    await telemetryIoHost.startTelemetry({ _: ['invalid'] }, new Context());

    expect(telemetryIoHost.telemetry).toBeUndefined();
  });

  describe('telemetry', () => {
    let telemetryIoHost: CliIoHost;
    let telemetryEmitSpy: jest.SpyInstance;
    let telemetryDir: string;

    beforeEach(async () => {
      // Create a telemetry file to satisfy requirements; we are not asserting on the file contents
      telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry'));
      const telemetryFilePath = path.join(telemetryDir, 'telemetry-file.json');

      // Create a new instance with telemetry enabled
      telemetryIoHost = CliIoHost.instance({
        logLevel: 'trace',
      }, true);
      await telemetryIoHost.startTelemetry({ '_': ['init'], 'telemetry-file': telemetryFilePath }, new Context());

      expect(telemetryIoHost.telemetry).toBeDefined();

      telemetryEmitSpy = jest.spyOn(telemetryIoHost.telemetry!, 'emit')
        .mockImplementation(async () => Promise.resolve());
    });

    afterEach(() => {
      fs.rmdirSync(telemetryDir, { recursive: true });
      jest.restoreAllMocks();
    });

    test('emit telemetry on SYNTH event', async () => {
      // Create a message that should trigger telemetry using the actual message code
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'trace',
        action: 'synth',
        code: 'CDK_CLI_I1001',
        message: 'telemetry message',
        data: {
          duration: 123,
        },
      };

      // Send the notification
      await telemetryIoHost.notify(message);

      // Verify that the emit method was called with the correct parameters
      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SYNTH',
        duration: 123,
      }));
    });

    test('emit telemetry on INVOKE event', async () => {
      // Create a message that should trigger telemetry using the actual message code
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'trace',
        action: 'synth',
        code: 'CDK_CLI_I2001',
        message: 'telemetry message',
        data: {
          duration: 123,
        },
      };

      // Send the notification
      await telemetryIoHost.notify(message);

      // Verify that the emit method was called with the correct parameters
      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'INVOKE',
        duration: 123,
      }));
    });

    test('do not emit telemetry on non telemetry codes', async () => {
      // Create a message that should trigger telemetry using the actual message code
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'trace',
        action: 'synth',
        code: 'CDK_CLI_I2000', // only I2001, I1001 are valid
        message: 'telemetry message',
        data: {
          duration: 123,
        },
      };

      // Send the notification
      await telemetryIoHost.notify(message);

      // Verify that the emit method was not called
      expect(telemetryEmitSpy).not.toHaveBeenCalled();
    });

    test('emit telemetry with counters', async () => {
      // Create a message that should trigger telemetry using the actual message code
      const message = {
        ...CLI_PRIVATE_IO.CDK_CLI_I1001.msg('telemetry message', {
          duration: 123,
          counters: {
            tests: 15,
          },
        }),
        action: 'synth' as const,
      };

      // Send the notification
      await telemetryIoHost.notify(message);

      // Verify that the emit method was called with the correct parameters
      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SYNTH',
        counters: { tests: 15 },
      }));
    });

    test('emit telemetry with error name', async () => {
      // Create a message that should trigger telemetry using the actual message code
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'trace',
        action: 'synth',
        code: 'CDK_CLI_I2001',
        message: 'telemetry message',
        data: {
          duration: 123,
          error: {
            name: 'MyError',
            message: 'Some message',
          },
        },
      };

      // Send the notification
      await telemetryIoHost.notify(message);

      // Verify that the emit method was called with the correct parameters
      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'INVOKE',
        duration: 123,
        error: {
          name: 'MyError',
          message: 'Some message',
        },
      }));
    });

    test('emit telemetry on HOTSWAP event with successful hotswap', async () => {
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'info',
        action: 'deploy',
        code: 'CDK_TOOLKIT_I5410',
        message: 'hotswap result',
        data: {
          duration: 456,
          hotswapped: true,
          hotswapFallback: false,
          hotswappableChanges: [{ a: 1 }, { b: 2 }],
          nonHotswappableChanges: [{ subject: { logicalId: 'C' } }],
          stack: {},
          mode: 'hotswap-only',
        },
      };

      await telemetryIoHost.notify(message);

      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'HOTSWAP',
        duration: 456,
        counters: {
          hotswapped: 1,
          hotswapFallback: 0,
          hotswappableChanges: 2,
          nonHotswappableChanges: 1,
        },
      }));
      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.not.objectContaining({
        error: expect.anything(),
      }));
    });

    test('emit telemetry on HOTSWAP event with error', async () => {
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'info',
        action: 'deploy',
        code: 'CDK_TOOLKIT_I5410',
        message: 'hotswap result',
        data: {
          duration: 200,
          hotswapped: false,
          hotswapFallback: false,
          hotswappableChanges: [{ a: 1 }],
          nonHotswappableChanges: [],
          stack: {},
          mode: 'hotswap-only',
          error: new Error('SDK call failed'),
        },
      };

      await telemetryIoHost.notify(message);

      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'HOTSWAP',
        duration: 200,
        error: expect.objectContaining({
          name: 'UnknownError',
        }),
        counters: {
          hotswapped: 0,
          hotswapFallback: 0,
          hotswappableChanges: 1,
          nonHotswappableChanges: 0,
        },
      }));
    });

    test('emit telemetry on HOTSWAP event with nonHotswappable resources', async () => {
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'info',
        action: 'deploy',
        code: 'CDK_TOOLKIT_I5410',
        message: 'hotswap result',
        data: {
          duration: 456,
          hotswapped: true,
          hotswapFallback: false,
          hotswappableChanges: [{ a: 1 }, { b: 2 }],
          nonHotswappableChanges: [{ subject: { resourceType: 'someResource', logicalId: 'A' } }, { subject: { resourceType: 'someOtherResource', rejectedProperties: ['Name', 'Id'], logicalId: 'B' } }, { subject: { logicalId: 'C' } }],
          stack: {},
          mode: 'hotswap-only',
        },
      };

      await telemetryIoHost.notify(message);

      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'HOTSWAP',
        duration: 456,
        counters: {
          'hotswapped': 1,
          'hotswapFallback': 0,
          'hotswappableChanges': 2,
          'nonHotswappableChanges': 3,
          'hotswapFallback:someResource': 1,
          'hotswapFallback:someOtherResource#Name': 1,
          'hotswapFallback:someOtherResource#Id': 1,
        },
      }));
      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.not.objectContaining({
        error: expect.anything(),
      }));
    });

    test('emit telemetry on failed HOTSWAP event with nonHotswappable resources and fallback enabled', async () => {
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'info',
        action: 'deploy',
        code: 'CDK_TOOLKIT_I5410',
        message: 'hotswap result',
        data: {
          duration: 456,
          hotswapped: false,
          hotswapFallback: true,
          hotswappableChanges: [{ a: 1 }, { b: 2 }],
          nonHotswappableChanges: [{ subject: { resourceType: 'someResource', logicalId: 'A' } }],
          stack: {},
          mode: 'hotswap-fallback',
        },
      };

      await telemetryIoHost.notify(message);

      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'HOTSWAP',
        duration: 456,
        counters: {
          'hotswapped': 0,
          'hotswapFallback': 1,
          'hotswappableChanges': 2,
          'nonHotswappableChanges': 1,
          'hotswapFallback:someResource': 1,
        },
      }));
      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.not.objectContaining({
        error: expect.anything(),
      }));
    });

    test('emit telemetry on HOTSWAP event with fallback enabled and a failed CloudFormation deployment', async () => {
      const message: IoMessage<unknown> = {
        time: new Date(),
        level: 'info',
        action: 'deploy',
        code: 'CDK_TOOLKIT_I5410',
        message: 'hotswap result',
        data: {
          duration: 200,
          hotswapped: false,
          hotswapFallback: true,
          hotswappableChanges: [{ a: 1 }],
          nonHotswappableChanges: [{ subject: { resourceType: 'someResource', logicalId: 'A' } }],
          stack: {},
          mode: 'hotswap-fallback',
          error: new Error('Failed to deploy'),
        },
      };

      await telemetryIoHost.notify(message);

      expect(telemetryEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'HOTSWAP',
        duration: 200,
        error: expect.objectContaining({
          name: 'UnknownError',
        }),
        counters: {
          'hotswapped': 0,
          'hotswapFallback': 1,
          'hotswappableChanges': 1,
          'nonHotswappableChanges': 1,
          'hotswapFallback:someResource': 1,
        },
      }));
    });
  });

  describe('requestResponse', () => {
    beforeEach(() => {
      ioHost.isTTY = true;
      ioHost.isCI = false;
    });

    test('fail if concurrency is > 1', async () => {
      await expect(() => ioHost.requestResponse({
        time: new Date(),
        level: 'info',
        action: 'synth',
        code: 'CDK_TOOLKIT_I0001',
        message: 'Continue?',
        defaultResponse: true,
        data: {
          concurrency: 3,
        },
      })).rejects.toThrow('but concurrency is greater than 1');
    });

    describe('request listeners', () => {
      function confirmRequest(message = 'Are you sure?'): IoRequest<any, boolean> {
        return plainMessage({
          time: new Date(),
          level: 'info',
          action: 'destroy',
          code: 'CDK_TOOLKIT_I7010',
          message,
          defaultResponse: false,
        }) as IoRequest<any, boolean>;
      }

      test('respond() answers a request without prompting or printing', async () => {
        const dispose = ioHost.respond(IO.CDK_TOOLKIT_I7010, true);

        const response = await ioHost.requestResponse(confirmRequest());

        expect(response).toBe(true);
        expect(mockStdout).not.toHaveBeenCalled();
        dispose();
      });

      test('respondOnce() answers only the first request, then defers to the prompt', async () => {
        const dispose = ioHost.respondOnce(IO.CDK_TOOLKIT_I7010, true);

        const first = await ioHost.requestResponse(confirmRequest());
        const second = await requestResponse('y', confirmRequest());

        expect(first).toBe(true);
        expect(second).toBe(true);
        // only the second request prompted; the first was answered silently
        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('Are you sure?') + ' (y/n) ');
        dispose();
      });

      test('a listener can reword the question that is prompted', async () => {
        const dispose = ioHost.rewrite(IO.CDK_TOOLKIT_I7010, () => 'Really delete everything?');

        const response = await requestResponse('y', confirmRequest());

        expect(response).toBe(true);
        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('Really delete everything?') + ' (y/n) ');
        dispose();
      });

      test('the returned dispose function removes the responder', async () => {
        const dispose = ioHost.respond(IO.CDK_TOOLKIT_I7010, true);
        dispose();

        // responder gone, so the host prompts as usual
        const response = await requestResponse('y', confirmRequest());

        expect(response).toBe(true);
        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('Are you sure?') + ' (y/n) ');
      });

      test('a respond value skips the prompt but still surfaces the question', async () => {
        // No preventDefault, so the question is written; but the prompt is
        // skipped and the request resolves with the supplied value.
        const dispose = ioHost.on(IO.CDK_TOOLKIT_I7010, () => ({ respond: true }));

        const response = await ioHost.requestResponse(confirmRequest());

        expect(response).toBe(true);
        expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('Are you sure?')); // surfaced, not prompted
        expect(mockStdout).not.toHaveBeenCalled();
        dispose();
      });

      test('respond + preventDefault skips the prompt and suppresses the question', async () => {
        const dispose = ioHost.on(IO.CDK_TOOLKIT_I7010, () => ({ respond: true, preventDefault: true }));

        const response = await ioHost.requestResponse(confirmRequest());

        expect(response).toBe(true);
        expect(mockStdout).not.toHaveBeenCalled();
        expect(mockStderr).not.toHaveBeenCalled();
        dispose();
      });

      test('preventDefault alone skips the prompt silently and resolves with the default', async () => {
        // confirmRequest()'s defaultResponse is false; preventDefault means the
        // listener handled it, so we return that default without prompting.
        const dispose = ioHost.on(IO.CDK_TOOLKIT_I7010, () => ({ preventDefault: true }));

        const response = await ioHost.requestResponse(confirmRequest());

        expect(response).toBe(false);
        expect(mockStdout).not.toHaveBeenCalled();
        expect(mockStderr).not.toHaveBeenCalled();
        dispose();
      });

      test('respond(..., false) answers the request while still surfacing the question', async () => {
        const dispose = ioHost.respond(IO.CDK_TOOLKIT_I7010, true, /* suppressQuestion */ false);

        const response = await ioHost.requestResponse(confirmRequest());

        expect(response).toBe(true);
        expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('Are you sure?'));
        expect(mockStdout).not.toHaveBeenCalled();
        dispose();
      });
    });

    describe('boolean', () => {
      test('respond "yes" to a confirmation prompt', async () => {
        const response = await requestResponse('y', plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'Continue?',
          defaultResponse: true,
        }));

        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('Continue?') + ' (y/n) ');
        expect(response).toBe(true);
      });

      test('respond "no" to a confirmation prompt returns false (the IoHost does not abort)', async () => {
        const response = await requestResponse('n', plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'Continue?',
          defaultResponse: true,
        }));

        expect(response).toBe(false);
        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('Continue?') + ' (y/n) ');
      });
    });

    describe('string', () => {
      test.each([
        ['bear', 'bear'],
        ['giraffe', 'giraffe'],
        // simulate the enter key
        ['\x0A', 'cat'],
      ])('receives %p and returns %p', async (input, expectedResponse) => {
        const response = await requestResponse(input, plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'Favorite animal',
          defaultResponse: 'cat',
        }));

        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('Favorite animal') + ' (cat) ');
        expect(response).toBe(expectedResponse);
      });
    });

    describe('number', () => {
      test.each([
        ['3', 3],
        // simulate the enter key
        ['\x0A', 1],
      ])('receives %p and return %p', async (input, expectedResponse) => {
        const response = await requestResponse(input, plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'How many would you like?',
          defaultResponse: 1,
        }));

        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('How many would you like?') + ' (1) ');
        expect(response).toBe(expectedResponse);
      });
    });

    describe('--yes mode', () => {
      const autoRespondingIoHost = CliIoHost.instance({
        logLevel: 'trace',
        autoRespond: true,
        isCI: false,
        isTTY: true,
      }, true);

      test('it does not prompt the user and return true', async () => {
        const notifySpy = jest.spyOn(autoRespondingIoHost, 'notify');

        // WHEN
        const response = await autoRespondingIoHost.requestResponse(plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'test message',
          defaultResponse: true,
        }));

        // THEN
        expect(mockStdout).not.toHaveBeenCalledWith(chalk.cyan('test message') + ' (y/n) ');
        expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
          message: chalk.cyan('test message') + ' (auto-confirmed)',
        }));
        expect(response).toBe(true);
      });

      test('messages with default are skipped', async () => {
        const notifySpy = jest.spyOn(autoRespondingIoHost, 'notify');

        // WHEN
        const response = await autoRespondingIoHost.requestResponse(plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I5060',
          message: 'test message',
          defaultResponse: 'foobar',
        }));

        // THEN
        expect(mockStdout).not.toHaveBeenCalledWith(chalk.cyan('test message') + ' (y/n) ');
        expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
          message: chalk.cyan('test message') + ' (auto-responded with default: foobar)',
        }));
        expect(response).toBe('foobar');
      });
    });

    describe('non-promptable data', () => {
      test('logs messages and returns default unchanged', async () => {
        const response = await ioHost.requestResponse(plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'test message',
          defaultResponse: [1, 2, 3],
        }));

        expect(mockStderr).toHaveBeenCalledWith(chalk.reset('test message') + '\n');
        expect(response).toEqual([1, 2, 3]);
      });
    });

    describe('non TTY environment', () => {
      beforeEach(() => {
        ioHost.isTTY = false;
        ioHost.isCI = false;
      });

      test('fail for all prompts', async () => {
        await expect(() => ioHost.requestResponse(plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'Continue?',
          defaultResponse: true,
        }))).rejects.toThrow('User input is needed');
      });

      test('fail with specific motivation', async () => {
        await expect(() => ioHost.requestResponse({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'Continue?',
          defaultResponse: true,
          data: {
            motivation: 'Bananas are yellow',
          },
        })).rejects.toThrow('Bananas are yellow');
      });

      test('returns the default for non-promptable requests', async () => {
        const response = await ioHost.requestResponse(plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I0001',
          message: 'test message',
          defaultResponse: [1, 2, 3],
        }));

        expect(mockStderr).toHaveBeenCalledWith('test message\n');
        expect(response).toEqual([1, 2, 3]);
      });
    });

    describe('requireApproval', () => {
      test('require approval by default - respond yes', async () => {
        const response = await requestResponse('y', plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I5060',
          message: 'test message',
          defaultResponse: true,
        }));

        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('test message') + ' (y/n) ');
        expect(response).toEqual(true);
      });

      test('require approval by default - respond no returns false', async () => {
        const response = await requestResponse('n', plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I5060',
          message: 'test message',
          defaultResponse: true,
        }));

        expect(response).toBe(false);
      });

      test('never require approval', async () => {
        ioHost.requireDeployApproval = RequireApproval.NEVER;
        const response = await ioHost.requestResponse(plainMessage({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I5060',
          message: 'test message',
          defaultResponse: true,
        }));

        expect(mockStdout).not.toHaveBeenCalledWith(chalk.cyan('test message') + ' (y/n) ');
        expect(response).toEqual(true);
      });

      test('broadening - require approval on broadening changes', async () => {
        ioHost.requireDeployApproval = RequireApproval.BROADENING;
        const response = await requestResponse('y', {
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I5060',
          message: 'test message',
          data: {
            permissionChangeType: 'broadening',
          },
          defaultResponse: true,
        });

        expect(mockStdout).toHaveBeenCalledWith(chalk.cyan('test message') + ' (y/n) ');
        expect(response).toEqual(true);
      });

      test('broadening - do not require approval on non-broadening changes', async () => {
        ioHost.requireDeployApproval = RequireApproval.BROADENING;
        const response = await ioHost.requestResponse({
          time: new Date(),
          level: 'info',
          action: 'synth',
          code: 'CDK_TOOLKIT_I5060',
          message: 'test message',
          data: {
            permissionChangeType: 'non-broadening',
          },
          defaultResponse: true,
        });

        expect(mockStdout).not.toHaveBeenCalledWith(chalk.cyan('test message') + ' (y/n) ');
        expect(response).toEqual(true);
      });
    });
  });
});

/**
 * Do a requestResponse cycle with the global ioHost, while sending input on the global fake input stream
 */
async function requestResponse<DataType, ResponseType>(input: string, msg: IoRequest<DataType, ResponseType>): Promise<ResponseType> {
  const promise = ioHost.requestResponse(msg);
  passThrough.write(input + '\n');
  return promise;
}

function plainMessage<A extends Omit<IoMessage<unknown> | IoRequest<unknown, unknown>, 'data'>>(m: A): A & { data: void } {
  return {
    ...m,
    data: undefined,
  };
}
