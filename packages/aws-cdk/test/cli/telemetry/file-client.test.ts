import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliIoHost } from '../../../lib/cli/io-host';
import { FileTelemetryClient } from '../../../lib/cli/telemetry/file-client';
import type { TelemetrySchema } from '../../../lib/cli/telemetry/schema';

describe('FileTelemetryClient', () => {
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
  });

  test('saves data to a file', async () => {
    // GIVEN
    const testEvent: TelemetrySchema = {
      identifiers: {
        cdkCliVersion: '1.0.0',
        telemetryVrsion: '1.0.0',
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
    const client = new FileTelemetryClient({ logFilePath, ioHost });

    // WHEN
    await client.emit(testEvent);

    // THEN
    expect(fs.existsSync(logFilePath)).toBe(true);
    const fileContent = fs.readFileSync(logFilePath, 'utf8');
    const parsedContent = JSON.parse(fileContent);
    expect(parsedContent).toEqual(testEvent);
  });
});
