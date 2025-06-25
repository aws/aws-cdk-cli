import * as https from 'https';
import { parse } from 'url';
import { CliIoHost } from '../../../lib/cli/io-host';
import { EndpointTelemetryClient } from '../../../lib/cli/telemetry/endpoint-client';
import type { TelemetrySchema } from '../../../lib/cli/telemetry/schema';

// Mock the https module
jest.mock('https', () => ({
  request: jest.fn(),
}));

// Helper function to create a test event
function createTestEvent(eventType: string, properties: Record<string, any> = {}): TelemetrySchema {
  return {
    identifiers: {
      cdkCliVersion: '1.0.0',
      telemetryVersion: '1.0.0',
      sessionId: 'test-session',
      eventId: `test-event-${eventType}`,
      installationId: 'test-installation',
      timestamp: new Date().toISOString(),
    },
    event: {
      state: 'SUCCEEDED',
      eventType,
      command: {
        path: ['test'],
        parameters: [],
        config: properties,
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
}

describe('EndpointTelemetryClient', () => {
  let ioHost: CliIoHost;

  beforeEach(() => {
    jest.resetAllMocks();

    ioHost = CliIoHost.instance();
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

  test('makes a POST request to the specified endpoint', async () => {
    // GIVEN
    const mockRequest = setupMockRequest();
    const endpoint = parse('https://example.com/telemetry');
    const testEvent = createTestEvent('test', { foo: 'bar' });
    const client = new EndpointTelemetryClient({ endpoint, ioHost });

    // WHEN
    await client.emit(testEvent);
    await client.flush();

    // THEN
    const expectedPayload = JSON.stringify([testEvent]);
    expect(https.request).toHaveBeenCalledWith({
      hostname: 'example.com',
      port: null,
      path: '/telemetry',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': expectedPayload.length,
      },
      timeout: 2000,
    }, expect.anything());

    expect(mockRequest.end).toHaveBeenCalledWith(expectedPayload);
  });

  test('silently catches request errors', async () => {
    // GIVEN
    const mockRequest = setupMockRequest();
    const endpoint = parse('https://example.com/telemetry');
    const testEvent = createTestEvent('test');
    const client = new EndpointTelemetryClient({ endpoint, ioHost });

    mockRequest.on.mockImplementation((event, callback) => {
      if (event === 'error') {
        callback(new Error('Network error'));
      }
      return mockRequest;
    });

    await client.emit(testEvent);

    // THEN
    await expect(client.flush()).resolves.not.toThrow();
  });

  test('multiple events sent as one', async () => {
    // GIVEN
    const mockRequest = setupMockRequest();
    const endpoint = parse('https://example.com/telemetry');
    const testEvent1 = createTestEvent('test1', { foo: 'bar' });
    const testEvent2 = createTestEvent('test2', { foo: 'bazoo' });
    const client = new EndpointTelemetryClient({ endpoint, ioHost });

    // WHEN
    await client.emit(testEvent1);
    await client.emit(testEvent2);
    await client.flush();

    // THEN
    const expectedPayload = JSON.stringify([testEvent1, testEvent2]);
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(https.request).toHaveBeenCalledWith({
      hostname: 'example.com',
      port: null,
      path: '/telemetry',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': expectedPayload.length,
      },
      timeout: 2000,
    }, expect.anything());

    expect(mockRequest.end).toHaveBeenCalledWith(expectedPayload);
  });

  test('successful flush clears events cache', async () => {
    // GIVEN
    setupMockRequest();
    const endpoint = parse('https://example.com/telemetry');
    const testEvent1 = createTestEvent('test1', { foo: 'bar' });
    const testEvent2 = createTestEvent('test2', { foo: 'bazoo' });
    const client = new EndpointTelemetryClient({ endpoint, ioHost });

    // WHEN
    await client.emit(testEvent1);
    await client.flush();
    await client.emit(testEvent2);
    await client.flush();

    // THEN
    const expectedPayload1 = JSON.stringify([testEvent1]);
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
      timeout: 2000,
    }, expect.anything());

    const expectedPayload2 = JSON.stringify([testEvent2]);
    expect(https.request).toHaveBeenCalledWith({
      hostname: 'example.com',
      port: null,
      path: '/telemetry',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': expectedPayload2.length,
      },
      timeout: 2000,
    }, expect.anything());
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

    const endpoint = parse('https://example.com/telemetry');
    const testEvent1 = createTestEvent('test1', { foo: 'bar' });
    const testEvent2 = createTestEvent('test2', { foo: 'bazoo' });
    const client = new EndpointTelemetryClient({ endpoint, ioHost });

    // WHEN
    await client.emit(testEvent1);

    // mocked to fail
    await client.flush();

    await client.emit(testEvent2);

    // mocked to succeed
    await client.flush();

    // THEN
    const expectedPayload1 = JSON.stringify([testEvent1]);
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
      timeout: 2000,
    }, expect.anything());

    const expectedPayload2 = JSON.stringify([testEvent2]);
    expect(https.request).toHaveBeenCalledWith({
      hostname: 'example.com',
      port: null,
      path: '/telemetry',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': expectedPayload1.length + expectedPayload2.length - 1,
      },
      timeout: 2000,
    }, expect.anything());
  });

  test('flush is called every 30 seconds', async () => {
    // GIVEN
    jest.useFakeTimers();
    setupMockRequest(); // Setup the mock request but we don't need the return value
    const endpoint = parse('https://example.com/telemetry');

    // Create a spy on setInterval
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    // Create the client
    const client = new EndpointTelemetryClient({ endpoint, ioHost });

    // Create a spy on the flush method
    const flushSpy = jest.spyOn(client, 'flush');

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
});
