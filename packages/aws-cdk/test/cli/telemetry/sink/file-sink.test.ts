import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { IoHelper } from '../../../../lib/api-private';
import { CliIoHost } from '../../../../lib/cli/io-host';
import type { TelemetrySchema } from '../../../../lib/cli/telemetry/schema';
import { FileTelemetrySink } from '../../../../lib/cli/telemetry/sink/file-sink';

describe('FileTelemetrySink', () => {
  let tempDir: string;
  let logFilePath: string;
  let ioHost: CliIoHost;

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = path.join(os.tmpdir(), `telemetry-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    logFilePath = path.join(tempDir, 'telemetry.json');

    ioHost = CliIoHost.instance();
  });

  afterEach(() => {
    // Clean up temp directory after each test
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir, { recursive: true });
    }

    // Restore all mocks
    jest.restoreAllMocks();
  });

  test('saves data to a file', async () => {
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
    const client = new FileTelemetrySink({ logFilePath, ioHost });

    // WHEN
    await client.emit(testEvent);

    // THEN
    expect(fs.existsSync(logFilePath)).toBe(true);
    const fileJson = fs.readJSONSync(logFilePath, 'utf8');
    expect(fileJson).toEqual([testEvent]);
  });

  test('appends data to a file', async () => {
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
    const client = new FileTelemetrySink({ logFilePath, ioHost });

    // WHEN
    await client.emit(testEvent);
    await client.emit(testEvent);

    // THEN
    expect(fs.existsSync(logFilePath)).toBe(true);
    const fileJson = fs.readJSONSync(logFilePath, 'utf8');
    const expectedJson = [testEvent, testEvent];
    expect(fileJson).toEqual(expectedJson);
  });

  test('constructor throws if file already exists', async () => {
    // GIVEN
    fs.writeFileSync(logFilePath, 'exists');

    // WHEN & THEN
    expect(() => new FileTelemetrySink({ logFilePath, ioHost })).toThrow(/Telemetry file already exists/);
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

    const client = new FileTelemetrySink({ logFilePath, ioHost });

    // Mock fs.writeJSONSync to throw an error
    jest.spyOn(fs, 'writeJSONSync').mockImplementation(() => {
      throw new Error('File write error');
    });

    // WHEN & THEN
    await expect(client.emit(testEvent)).resolves.not.toThrow();

    // Verify that the error was logged to trace
    expect(traceSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to add telemetry event:'),
    );
  });
});
