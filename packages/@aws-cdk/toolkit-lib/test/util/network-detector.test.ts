import * as https from 'https';
import { NetworkDetector } from '../../lib/util/network-detector';

// Mock the https module
jest.mock('https');
const mockHttps = https as jest.Mocked<typeof https>;

describe('NetworkDetector', () => {
  let mockRequest: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest = jest.fn();
    mockHttps.request.mockImplementation(mockRequest);

    // Clear static cache between tests
    (NetworkDetector as any).cachedResult = undefined;
    (NetworkDetector as any).cacheExpiry = 0;
  });

  test('returns true when server responds with success status', async () => {
    const mockReq = {
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    mockRequest.mockImplementation((_options, callback) => {
      callback({ statusCode: 200 });
      return mockReq;
    });

    const result = await NetworkDetector.hasConnectivity();
    expect(result).toBe(true);
  });

  test('returns false when server responds with server error', async () => {
    const mockReq = {
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    mockRequest.mockImplementation((_options, callback) => {
      callback({ statusCode: 500 });
      return mockReq;
    });

    const result = await NetworkDetector.hasConnectivity();
    expect(result).toBe(false);
  });

  test('returns false on network error', async () => {
    const mockReq = {
      on: jest.fn((event, handler) => {
        if (event === 'error') {
          setTimeout(() => handler(new Error('Network error')), 0);
        }
      }),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    mockRequest.mockReturnValue(mockReq);

    const result = await NetworkDetector.hasConnectivity();
    expect(result).toBe(false);
  });

  test('returns false on timeout', async () => {
    const mockReq = {
      on: jest.fn((event, handler) => {
        if (event === 'timeout') {
          setTimeout(() => handler(), 0);
        }
      }),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    mockRequest.mockReturnValue(mockReq);

    const result = await NetworkDetector.hasConnectivity();
    expect(result).toBe(false);
  });

  test('caches result for subsequent calls', async () => {
    const mockReq = {
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    mockRequest.mockImplementation((_options, callback) => {
      callback({ statusCode: 200 });
      return mockReq;
    });

    await NetworkDetector.hasConnectivity();
    await NetworkDetector.hasConnectivity();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
