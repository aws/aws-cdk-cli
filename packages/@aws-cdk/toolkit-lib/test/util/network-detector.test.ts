import * as https from 'https';
import * as fs from 'fs-extra';
import { NetworkDetector } from '../../lib/util/network-detector';

// Mock the https module
jest.mock('https');
const mockHttps = https as jest.Mocked<typeof https>;

// Mock fs-extra
jest.mock('fs-extra');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock cdkCacheDir
jest.mock('../../lib/util', () => ({
  cdkCacheDir: jest.fn(() => '/mock/cache/dir'),
}));

describe('NetworkDetector', () => {
  let mockRequest: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest = jest.fn();
    mockHttps.request.mockImplementation(mockRequest);
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

    mockFs.existsSync.mockReturnValue(false);
    (mockFs.ensureFile as jest.Mock).mockResolvedValue(undefined);
    (mockFs.writeJSON as jest.Mock).mockResolvedValue(undefined);

    const result = await NetworkDetector.hasConnectivity();
    expect(result).toBe(true); // Should return true for successful HTTP response
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

    mockFs.existsSync.mockReturnValue(false);
    (mockFs.ensureFile as jest.Mock).mockResolvedValue(undefined);
    (mockFs.writeJSON as jest.Mock).mockResolvedValue(undefined);

    const result = await NetworkDetector.hasConnectivity();
    expect(result).toBe(false); // Should return false for server error status codes
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
    mockFs.existsSync.mockReturnValue(false);

    const result = await NetworkDetector.hasConnectivity();
    expect(result).toBe(false); // Should return false when network request fails
  });

  test('returns cached result from disk when not expired', async () => {
    const cachedData = {
      expiration: Date.now() + 30000, // 30 seconds in future
      hasConnectivity: true,
    };

    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readJSON as jest.Mock).mockResolvedValue(cachedData);

    const result = await NetworkDetector.hasConnectivity();

    expect(result).toBe(true); // Should return cached connectivity result
    expect(mockRequest).not.toHaveBeenCalled(); // Should not make network request when cache is valid
  });

  test('performs ping when disk cache is expired', async () => {
    const expiredData = {
      expiration: Date.now() - 1000, // 1 second ago
      hasConnectivity: true,
    };

    const mockReq = {
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    mockRequest.mockImplementation((_options, callback) => {
      callback({ statusCode: 200 });
      return mockReq;
    });

    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readJSON as jest.Mock).mockResolvedValue(expiredData);
    (mockFs.ensureFile as jest.Mock).mockResolvedValue(undefined);
    (mockFs.writeJSON as jest.Mock).mockResolvedValue(undefined);

    const result = await NetworkDetector.hasConnectivity();

    expect(result).toBe(true); // Should return fresh connectivity result
    expect(mockRequest).toHaveBeenCalledTimes(1); // Should make network request when cache is expired
  });

  test('handles cache save errors gracefully', async () => {
    const mockReq = {
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    mockRequest.mockImplementation((_options, callback) => {
      callback({ statusCode: 200 });
      return mockReq;
    });

    mockFs.existsSync.mockReturnValue(false);
    (mockFs.ensureFile as jest.Mock).mockRejectedValue(new Error('Disk full'));

    const result = await NetworkDetector.hasConnectivity();

    expect(result).toBe(true); // Should still return connectivity result despite cache save failure
  });

  test('handles cache load errors gracefully', async () => {
    const mockReq = {
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    mockRequest.mockImplementation((_options, callback) => {
      callback({ statusCode: 200 });
      return mockReq;
    });

    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readJSON as jest.Mock).mockRejectedValue(new Error('Read failed'));
    (mockFs.ensureFile as jest.Mock).mockResolvedValue(undefined);
    (mockFs.writeJSON as jest.Mock).mockResolvedValue(undefined);

    const result = await NetworkDetector.hasConnectivity();

    expect(result).toBe(true); // Should still return connectivity result despite cache load failure
  });
});
