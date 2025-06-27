import { PassThrough } from 'stream';
import { CliIoHost } from '../../../lib/cli/io-host';
import { IoHostTelemetryClient } from '../../../lib/cli/telemetry/io-host-client';
import type { TelemetrySchema } from '../../../lib/cli/telemetry/schema';

let passThrough: PassThrough;

// Mess with the 'process' global so we can replace its 'process.stdin' member
global.process = { ...process };

describe('IoHostTelemetryClient', () => {
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
        eventType: 'test',
        command: {
          path: ['test'],
          parameters: [],
          config: { foo: 'bar' },
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
    const client = new IoHostTelemetryClient({ ioHost });

    // WHEN
    await client.emit(testEvent);

    // THEN
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('--- TELEMETRY EVENT ---'));
  });
});
