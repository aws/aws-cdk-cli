import { PassThrough } from 'stream';
import { CliIoHost } from '../../../lib/cli/io-host';
import { IoHostTelemetryClient } from '../../../lib/cli/telemetry/io-host-client';

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
    
    ioHost = CliIoHost.instance();

    (process as any).stdin = passThrough = new PassThrough();
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

  test('adds events to collection', async () => {
    // GIVEN
    const testEvent = { event: 'test', properties: { foo: 'bar' } };
    const client = new IoHostTelemetryClient({ ioHost });
    
    // WHEN
    await client.addEvent(testEvent);
    await client.flush();
    
    // THEN
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('--- TELEMETRY EVENTS ---'));
  });
});