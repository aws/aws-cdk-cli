import { PassThrough } from 'stream';
import { IoHelper } from '../../../lib/api-private';
import { CliIoHost } from '../../../lib/cli/io-host';
import { IoHostTelemetrySink } from '../../../lib/cli/telemetry/io-host-sink';
import type { TelemetrySchema } from '../../../lib/cli/telemetry/schema';

let passThrough: PassThrough;

// Mess with the 'process' global so we can replace its 'process.stdin' member
global.process = { ...process };

describe('IoHostTelemetrySink', () => {
  let mockStdout: jest.Mock;
  let mockStderr: jest.Mock;
  let ioHost: CliIoHost;

  beforeEach(() => {
    mockStdout = jest.fn();
    mockStderr = jest.fn();

    ioHost = CliIoHost.instance({
      isCI: false,
    });

    (process as any).stdin = passThrough = new PassThrough();
    jest.spyOn(process.stdout, 'write').mockImplementation((str: any, encoding?: any, cb?: any) => {
      mockStdout(str.toString());
      const callback = typeof encoding === 'function' ? encoding : cb;
      if (callback) callback();
      passThrough.write('\n');
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

  test('adds events to collection', async () => {
    // GIVEN
    const testEvent: TelemetrySchema = {
      identifiers: {
        cdkCliVersion: '1.0.0',
        telemetryVersion: '1.0.0',
        sessionId: 'test-session',
        eventId: 'test-event',
        installationId: 'test-installation',
        timestamp: new Date().toISOString(),
      },
      event: {
        state: 'SUCCEEDED',
        eventType: 'INVOKE',
        command: {
          path: ['test'],
          parameters: {},
          config: { context: { foo: true } },
        },
      },
      environment: {
        os: {
          platform: 'test',
          release: 'test',
        },
        ci: false,
        nodeVersion: process.version,
      },
      project: {},
      duration: {
        total: 0,
      },
    };

    // Create a mock IoHelper that writes to stderr like the original
    const mockIoHelper = {
      defaults: {
        trace: async (message: string) => {
          mockStderr(message);
        },
      },
    };

    // Mock IoHelper.fromActionAwareIoHost to return our mock
    jest.spyOn(IoHelper, 'fromActionAwareIoHost').mockReturnValue(mockIoHelper as any);

    const client = new IoHostTelemetrySink({ ioHost });

    // WHEN
    await client.emit(testEvent);

    // THEN
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('--- TELEMETRY EVENT ---'));
  });

  test('handles errors gracefully and logs to trace without throwing', async () => {
    // GIVEN
    const testEvent: TelemetrySchema = {
      identifiers: {
        cdkCliVersion: '1.0.0',
        telemetryVersion: '1.0.0',
        sessionId: 'test-session',
        eventId: 'test-event',
        installationId: 'test-installation',
        timestamp: new Date().toISOString(),
      },
      event: {
        state: 'SUCCEEDED',
        eventType: 'INVOKE',
        command: {
          path: ['test'],
          parameters: {},
          config: { context: { foo: true } },
        },
      },
      environment: {
        os: {
          platform: 'test',
          release: 'test',
        },
        ci: false,
        nodeVersion: process.version,
      },
      project: {},
      duration: {
        total: 0,
      },
    };

    // Create a mock IoHelper with trace spy
    const traceSpy = jest.fn();
    const mockIoHelper = {
      defaults: {
        trace: traceSpy,
      },
    };

    // Mock IoHelper.fromActionAwareIoHost to return our mock
    jest.spyOn(IoHelper, 'fromActionAwareIoHost').mockReturnValue(mockIoHelper as any);

    const client = new IoHostTelemetrySink({ ioHost });

    // Mock JSON.stringify to throw an error
    jest.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new Error('JSON stringify error');
    });

    // WHEN & THEN
    await expect(client.emit(testEvent)).resolves.not.toThrow();

    // Verify that the error was logged to trace
    expect(traceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to add telemetry event:'),
    );
  });
});
