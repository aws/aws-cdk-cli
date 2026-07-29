import { spawn } from 'node:child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createTestEvent } from './util';
import { IoHelper } from '../../../../lib/api-private';
import { CliIoHost } from '../../../../lib/cli/io-host';
import { EndpointTelemetrySink } from '../../../../lib/cli/telemetry/sink/endpoint-sink';
import { FileTelemetrySink } from '../../../../lib/cli/telemetry/sink/file-sink';
import { Funnel } from '../../../../lib/cli/telemetry/sink/funnel';

// The endpoint sink hands the payload to a detached child process rather than making the request
// itself, so this is what has to be intercepted.
jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const BIN_CDK = '/fake/pkg/bin/cdk';

describe('Funnel', () => {
  let tempDir: string;
  let logFilePath: string;
  let ioHost: CliIoHost;
  let child: { pid: number; on: jest.Mock; unref: jest.Mock; stdin: { on: jest.Mock; end: jest.Mock } };

  beforeEach(() => {
    jest.resetAllMocks();

    child = {
      pid: 4242,
      on: jest.fn(),
      unref: jest.fn(),
      stdin: { on: jest.fn(), end: jest.fn() },
    };
    (spawn as jest.Mock).mockReturnValue(child);

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

  describe('File and Endpoint', () => {
    let fileSink: FileTelemetrySink;
    let endpointSink: EndpointTelemetrySink;
    const traceSpy = jest.fn();

    beforeEach(() => {
      // Create a mock IoHelper with trace spy
      const mockIoHelper = {
        defaults: {
          trace: traceSpy,
        },
      };

      // Mock IoHelper.fromActionAwareIoHost to return our mock
      jest.spyOn(IoHelper, 'fromActionAwareIoHost').mockReturnValue(mockIoHelper as any);

      fileSink = new FileTelemetrySink({ ioHost, logFilePath });
      endpointSink = new EndpointTelemetrySink({ ioHost, endpoint: 'https://example.com/telemetry', binCdkPath: BIN_CDK });
    });

    /**
     * The JSON that was piped to the detached sender on the Nth spawn.
     */
    function pipedPayload(nth = 0) {
      return JSON.parse(child.stdin.end.mock.calls[nth][0]);
    }

    test('saves data to a file', async () => {
      // GIVEN
      const testEvent = createTestEvent('INVOKE', { context: { foo: true } });
      const client = new Funnel({ sinks: [fileSink, endpointSink] });

      // WHEN
      await client.emit(testEvent);

      // THEN
      // The file sink is deliberately still synchronous: the data must be on disk as soon as
      // `emit` resolves, because `--telemetry-file` consumers read it immediately after the CLI
      // exits.
      expect(fs.existsSync(logFilePath)).toBe(true);
      const fileJson = fs.readJSONSync(logFilePath, 'utf8');
      expect(fileJson).toEqual([testEvent]);
    });

    test('dispatches the batch to a detached sender', async () => {
      // GIVEN
      const testEvent = createTestEvent('INVOKE', { foo: 'bar' });
      const client = new Funnel({ sinks: [fileSink, endpointSink] });

      // WHEN
      await client.emit(testEvent);
      await client.flush();

      // THEN
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(process.execPath, [BIN_CDK], expect.objectContaining({
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      }));
      expect(pipedPayload()).toEqual({
        endpoint: 'https://example.com/telemetry',
        body: { events: [testEvent] },
        timeoutMs: 500,
      });
    });

    test('flush is called every 30 seconds on the endpoint sink only', async () => {
      // GIVEN
      jest.useFakeTimers();

      // Spy on the EndpointTelemetrySink prototype flush method BEFORE creating any instances
      const flushSpy = jest.spyOn(EndpointTelemetrySink.prototype, 'flush').mockResolvedValue();

      // Create a fresh endpoint sink for this test - the setInterval will be set up in constructor
      const testEndpointSink = new EndpointTelemetrySink({ ioHost, endpoint: 'https://example.com/telemetry', binCdkPath: BIN_CDK });
      new Funnel({ sinks: [fileSink, testEndpointSink] });

      // Reset the spy call count since the constructor might have called flush
      flushSpy.mockClear();

      // WHEN & THEN
      // Initially no calls from the interval (the setInterval hasn't fired yet)
      expect(flushSpy).toHaveBeenCalledTimes(0);

      // Advance the timer by 30 seconds - this should trigger the first interval flush
      jest.advanceTimersByTime(30000);

      // Verify flush was called once
      expect(flushSpy).toHaveBeenCalledTimes(1);

      // Advance the timer by another 30 seconds - this should trigger the second interval flush
      jest.advanceTimersByTime(30000);

      // Verify flush was called again (total of 2 times)
      expect(flushSpy).toHaveBeenCalledTimes(2);

      // Clean up
      flushSpy.mockRestore();
      jest.useRealTimers();
    });

    test('failed flush does not clear events cache', async () => {
      // GIVEN a first dispatch that cannot be handed off, and a second one that can
      (spawn as jest.Mock).mockImplementationOnce(() => {
        throw new Error('EAGAIN');
      }).mockImplementation(() => child);

      const testEvent1 = createTestEvent('INVOKE', { foo: 'bar' });
      const testEvent2 = createTestEvent('INVOKE', { foo: 'bazoo' });
      const client = new Funnel({ sinks: [fileSink, endpointSink] });

      // WHEN
      await client.emit(testEvent1);

      // mocked to fail
      await client.flush();

      await client.emit(testEvent2);

      // mocked to succeed
      await client.flush();

      // THEN both events are still delivered together on the retry
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(child.stdin.end).toHaveBeenCalledTimes(1);
      expect(pipedPayload().body).toEqual({ events: [testEvent1, testEvent2] });
    });

    test('handles errors gracefully and logs to trace without throwing', async () => {
      // GIVEN
      const testEvent = createTestEvent('INVOKE');

      const client = new Funnel({ sinks: [fileSink, endpointSink] });

      // Spawning the sender fails
      (spawn as jest.Mock).mockImplementation(() => {
        throw new Error('Spawn error');
      });

      await client.emit(testEvent);

      // WHEN & THEN - flush should not throw even when spawning fails
      await client.flush();

      // Verify that the error was logged to trace
      expect(traceSpy).toHaveBeenCalledWith(
        expect.stringContaining('Telemetry Error: spawning sender for POST example.com/telemetry'),
      );
    });

    test('throws when too many sinks are added', async () => {
      expect(() => new Funnel({ sinks: [fileSink, fileSink, fileSink, fileSink, fileSink, fileSink] })).toThrow(/Funnel class supports a maximum of 5 parallel sinks, got 6 sinks./);
    });
  });
});
