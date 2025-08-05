import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createTestEvent } from './util';
import { IoHelper } from '../../../../lib/api-private';
import { CliIoHost } from '../../../../lib/cli/io-host';
import { EndpointTelemetrySink } from '../../../../lib/cli/telemetry/sink/endpoint-sink';
import { FileTelemetrySink } from '../../../../lib/cli/telemetry/sink/file-sink';
import { Funnel } from '../../../../lib/cli/telemetry/sink/funnel';

// Mock the https module
jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('Funnel', () => {
  let tempDir: string;
  let logFilePath: string;
  let ioHost: CliIoHost;

  beforeEach(() => {
    jest.resetAllMocks();

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

  // Helper to create a mock request object with the necessary event handlers
  function setupMockRequest() {
    // Create a mock response object with a successful status code
    const mockResponse = {
      statusCode: 200,
      statusMessage: 'OK',
    };

    // Create the mock request object
    const mockRequest = {
      on: jest.fn(),
      end: jest.fn(),
      setTimeout: jest.fn(),
    };

    // Mock the https.request to return our mockRequest
    (https.request as jest.Mock).mockImplementation((_, callback) => {
      // If a callback was provided, call it with our mock response
      if (callback) {
        setTimeout(() => callback(mockResponse), 0);
      }
      return mockRequest;
    });

    return mockRequest;
  }

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
      endpointSink = new EndpointTelemetrySink({ ioHost, endpoint: 'https://example.com/telemetry' });
    });

    test('saves data to a file', async () => {
      // GIVEN
      const testEvent = createTestEvent('INVOKE', { context: { foo: true } });
      const client = new Funnel({ sinks: [fileSink, endpointSink] });

      // WHEN
      await client.emit(testEvent);

      // THEN
      expect(fs.existsSync(logFilePath)).toBe(true);
      const fileJson = fs.readJSONSync(logFilePath, 'utf8');
      expect(fileJson).toEqual([testEvent]);
    });

    test('makes a POST request to the specified endpoint', async () => {
      // GIVEN
      const mockRequest = setupMockRequest();
      const testEvent = createTestEvent('INVOKE', { foo: 'bar' });
      const client = new Funnel({ sinks: [fileSink, endpointSink] });

      // WHEN
      await client.emit(testEvent);
      await client.flush();

      // THEN
      const expectedPayload = JSON.stringify({ events: [testEvent] });
      expect(https.request).toHaveBeenCalledWith({
        hostname: 'example.com',
        port: null,
        path: '/telemetry',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': expectedPayload.length,
        },
        agent: undefined,
        timeout: 500,
      }, expect.anything());

      expect(mockRequest.end).toHaveBeenCalledWith(expectedPayload);
    });

    test('flush is called every 30 seconds on the endpoint sink only', async () => {
      // GIVEN
      jest.useFakeTimers();
      setupMockRequest();

      // Spy on the EndpointTelemetrySink prototype flush method BEFORE creating any instances
      const flushSpy = jest.spyOn(EndpointTelemetrySink.prototype, 'flush').mockResolvedValue();

      // Create a fresh endpoint sink for this test - the setInterval will be set up in constructor
      const testEndpointSink = new EndpointTelemetrySink({ ioHost, endpoint: 'https://example.com/telemetry' });
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
      // GIVEN
      const mockRequest = {
        on: jest.fn(),
        end: jest.fn(),
        setTimeout: jest.fn(),
      };
      // Mock the https.request to return the first response as 503
      (https.request as jest.Mock).mockImplementationOnce((_, callback) => {
        // If a callback was provided, call it with our mock response
        if (callback) {
          setTimeout(() => callback({
            statusCode: 503,
            statusMessage: 'Service Unavailable',
          }), 0);
        }
        return mockRequest;
      }).mockImplementation((_, callback) => {
        if (callback) {
          setTimeout(() => callback({
            statusCode: 200,
            statusMessage: 'Success',
          }), 0);
        }
        return mockRequest;
      });

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

      // THEN
      const expectedPayload1 = JSON.stringify({ events: [testEvent1] });
      expect(https.request).toHaveBeenCalledTimes(2);
      expect(https.request).toHaveBeenCalledWith({
        hostname: 'example.com',
        port: null,
        path: '/telemetry',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': expectedPayload1.length,
        },
        agent: undefined,
        timeout: 500,
      }, expect.anything());

      const expectedPayload2 = JSON.stringify({ events: [testEvent1, testEvent2] });
      expect(https.request).toHaveBeenCalledWith({
        hostname: 'example.com',
        port: null,
        path: '/telemetry',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': expectedPayload2.length,
        },
        agent: undefined,
        timeout: 500,
      }, expect.anything());
    });

    test('handles errors gracefully and logs to trace without throwing', async () => {
      // GIVEN
      const testEvent = createTestEvent('INVOKE');

      const client = new Funnel({ sinks: [fileSink, endpointSink] });

      // Mock https.request to throw an error
      (https.request as jest.Mock).mockImplementation(() => {
        throw new Error('Network error');
      });

      await client.emit(testEvent);

      // WHEN & THEN - flush should not throw even when https.request fails
      await client.flush();

      // Verify that the error was lt
      // logged to trace
      expect(traceSpy).toHaveBeenCalledWith(
        expect.stringContaining('Telemetry Error: POST example.com/telemetry:'),
      );
    });

    test('throws when too many sinks are added', async () => {
      expect(() => new Funnel({ sinks: [fileSink, fileSink, fileSink, fileSink, fileSink, fileSink]})).toThrow(/Funnel class supports a maximum of 5 parallel sinks, got 6 sinks./);
    });
  });
});
