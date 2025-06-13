import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileTelemetryClient } from '../../../lib/cli/telemetry/file-client';
import { CliIoHost } from '../../../lib/cli/io-host';

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
    const testEvent = { event: 'test', properties: { foo: 'bar' } };
    const client = new FileTelemetryClient({ logFilePath, ioHost });
    
    // WHEN
    await client.addEvent(testEvent);
    await client.flush();
    
    // THEN
    expect(fs.existsSync(logFilePath)).toBe(true);
    const fileContent = fs.readFileSync(logFilePath, 'utf8');
    const parsedContent = JSON.parse(fileContent);
    expect(parsedContent).toEqual([testEvent]);
  });
});
