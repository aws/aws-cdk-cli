import * as https from 'https';
import { EndpointTelemetryClient } from '../../../lib/cli/telemetry/endpoint-client';
import { CliIoHost } from '../../../lib/cli/io-host';

// Mock the https module
jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('EndpointTelemetryClient', () => {
  let ioHost: CliIoHost;
    
  beforeEach(() => {
    jest.resetAllMocks();

    ioHost = CliIoHost.instance();
  });

  // Helper to create a mock request object with the necessary event handlers
  function setupMockRequest() {
    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn().mockImplementation((callback) => callback && callback()),
      setTimeout: jest.fn().mockImplementation((_, callback) => callback && callback()),
    };
    
    (https.request as jest.Mock).mockReturnValue(mockRequest);
    
    return mockRequest;
  }

  test('makes a POST request to the specified endpoint', async () => {
    // GIVEN
    const mockRequest = setupMockRequest();
    const endpoint = new URL('https://example.com/telemetry');
    const testEvent = { event: 'test', properties: { foo: 'bar' }};
    const client = new EndpointTelemetryClient({ endpoint, ioHost});
    
    // WHEN
    await client.addEvent(testEvent);
    await client.flush();
    
    // THEN
    const expectedPayload = JSON.stringify([testEvent]);
    expect(https.request).toHaveBeenCalledWith({
      hostname: 'example.com',
      port: '',
      path: '/telemetry',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': expectedPayload.length,
      },
    });
    
    expect(mockRequest.write).toHaveBeenCalledWith(expectedPayload);
    expect(mockRequest.end).toHaveBeenCalled();
  });

  test('silently catches request errors', async () => {
    // GIVEN
    const mockRequest = setupMockRequest();
    const endpoint = new URL('https://example.com/telemetry');
    const testEvent = { event: 'test' };
    const client = new EndpointTelemetryClient({ endpoint, ioHost });
    
    mockRequest.on.mockImplementation((event, callback) => {
      if (event === 'error') {
        callback(new Error('Network error'));
      }
      return mockRequest;
    });

    client.addEvent(testEvent);
    
    // THEN
    await expect(client.flush()).resolves.not.toThrow();
  });

  test('multiple events sent as one', async () => {
    // GIVEN
    const mockRequest = setupMockRequest();
    const endpoint = new URL('https://example.com/telemetry');
    const testEvent1 = { event: 'test1', properties: { foo: 'bar' }};
    const testEvent2 = { event: 'test2', properties: { foo: 'bazoo'}};
    const client = new EndpointTelemetryClient({ endpoint, ioHost});
    
    // WHEN
    await client.addEvent(testEvent1);
    await client.addEvent(testEvent2);
    await client.flush();
    
    // THEN
    const expectedPayload = JSON.stringify([testEvent1, testEvent2]);
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(https.request).toHaveBeenCalledWith({
      hostname: 'example.com',
      port: '',
      path: '/telemetry',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': expectedPayload.length,
      },
    });
    
    expect(mockRequest.write).toHaveBeenCalledWith(expectedPayload);
    expect(mockRequest.end).toHaveBeenCalled();
  });

  test('flush clears events cache', async () => {
    // GIVEN
    setupMockRequest();
    const endpoint = new URL('https://example.com/telemetry');
    const testEvent1 = { event: 'test1', properties: { foo: 'bar' }};
    const testEvent2 = { event: 'test2', properties: { foo: 'bazoo'}};
    const client = new EndpointTelemetryClient({ endpoint, ioHost});
    
    // WHEN
    await client.addEvent(testEvent1);
    await client.flush();
    await client.addEvent(testEvent2);
    await client.flush();
    
    // THEN
    const expectedPayload1 = JSON.stringify([testEvent1]);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(https.request).toHaveBeenCalledWith({
      hostname: 'example.com',
      port: '',
      path: '/telemetry',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': expectedPayload1.length,
      },
    });

    const expectedPayload2 = JSON.stringify([testEvent2]);
    expect(https.request).toHaveBeenCalledWith({
      hostname: 'example.com',
      port: '',
      path: '/telemetry',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': expectedPayload2.length,
      },
    });
  });
});
