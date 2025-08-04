import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createTestEvent } from './util';
import { IoHelper } from '../../../../lib/api-private';
import { CliIoHost } from '../../../../lib/cli/io-host';
import type { TelemetrySchema } from '../../../../lib/cli/telemetry/schema';
import { FileEndpointTelemetrySink } from '../../../../lib/cli/telemetry/sink/file-endpoint-sink';

// Mock the https module
jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('FileEndpointTelemetrySink', () => {
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

  describe('File', () => {
    test('saves data to a file', async () => {
      // GIVEN
      const testEvent = createTestEvent('INVOKE', { context: { foo: true } });
      const client = new FileEndpointTelemetrySink({ endpoint: 'https://example.com/telemetry', logFilePath, ioHost });

      // WHEN
      await client.emit(testEvent);

      // THEN
      expect(fs.existsSync(logFilePath)).toBe(true);
      const fileJson = fs.readJSONSync(logFilePath, 'utf8');
      expect(fileJson).toEqual([testEvent]);
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

      const client = new FileEndpointTelemetrySink({ endpoint: 'https://example.com/telemetry', logFilePath, ioHost });

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

  describe('Endpoint', () => {
    test('makes a POST request to the specified endpoint', async () => {
      // GIVEN
      const mockRequest = setupMockRequest();
      const testEvent = createTestEvent('INVOKE', { foo: 'bar' });
      const client = new FileEndpointTelemetrySink({ endpoint: 'https://example.com/telemetry', logFilePath, ioHost });

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
      setupMockRequest(); // Setup the mock request but we don't need the return value

      // Create a spy on setInterval
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      // Create the client
      const client = new FileEndpointTelemetrySink({ endpoint: 'https://example.com/telemetry', logFilePath, ioHost });

      // Create a spy on the flush method for the endpoint sink
      const flushSpy = jest.spyOn((client as any).endpointSink, 'flush');

      // WHEN
      // Advance the timer by 30 seconds
      jest.advanceTimersByTime(30000);

      // THEN
      // Verify setInterval was called with the correct interval
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

      // Verify flush was called
      expect(flushSpy).toHaveBeenCalledTimes(1);

      // Advance the timer by another 30 seconds
      jest.advanceTimersByTime(30000);

      // Verify flush was called again
      expect(flushSpy).toHaveBeenCalledTimes(2);

      // Clean up
      jest.useRealTimers();
      setIntervalSpy.mockRestore();
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
      const client = new FileEndpointTelemetrySink({ endpoint: 'https://example.com/telemetry', logFilePath, ioHost });

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

      // Create a mock IoHelper with trace spy
      const traceSpy = jest.fn();
      const mockIoHelper = {
        defaults: {
          trace: traceSpy,
        },
      };

      // Mock IoHelper.fromActionAwareIoHost to return our mock
      jest.spyOn(IoHelper, 'fromActionAwareIoHost').mockReturnValue(mockIoHelper as any);

      const client = new FileEndpointTelemetrySink({ endpoint: 'https://example.com/telemetry', logFilePath, ioHost });

      // Mock https.request to throw an error
      (https.request as jest.Mock).mockImplementation(() => {
        throw new Error('Network error');
      });

      await client.emit(testEvent);

      // WHEN & THEN - flush should not throw even when https.request fails
      await expect(client.flush()).resolves.not.toThrow();

      // Verify that the error was logged to trace
      expect(traceSpy).toHaveBeenCalledWith(
        expect.stringContaining('Telemetry Error: POST example.com/telemetry:'),
      );
    });
  });
});
