import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TelemetryClient } from '../../../lib/cli/telemetry/client';

// Mock the https module
jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('TelemetryClient', () => {
  let tempDir: string;
  let localFilePath: string;
    
  beforeEach(() => {
    jest.resetAllMocks();

    // Create a fresh temp directory for each test
    tempDir = path.join(os.tmpdir(), `telemetry-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    localFilePath = path.join(tempDir, 'telemetry.json');
  });
    
  afterEach(() => {
    // Clean up temp directory after each test
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir, { recursive: true });
    }
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

  describe('sendData', () => {
    test('makes a POST request to the specified endpoint', async () => {
      // GIVEN
      const mockRequest = setupMockRequest();
      const endpoint = new URL('https://example.com/telemetry');
      const testData = { event: 'test', properties: { foo: 'bar' } };
      const client = new TelemetryClient({ endpoint, localFilePath });
      
      // WHEN
      await client.sendData(testData);
      
      // THEN
      expect(https.request).toHaveBeenCalledWith({
        hostname: 'example.com',
        port: '',
        path: '/telemetry',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': 43,
        },
      });
      
      const expectedPayload = JSON.stringify(testData);
      expect(mockRequest.write).toHaveBeenCalledWith(expectedPayload);
      expect(mockRequest.end).toHaveBeenCalled();
    });

    test('silently catches request errors', async () => {
      // GIVEN
      const mockRequest = setupMockRequest();
      const endpoint = new URL('https://example.com/telemetry');
      const testData = { event: 'test' };
      const client = new TelemetryClient({ endpoint, localFilePath });
      
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Network error'));
        }
        return mockRequest;
      });
      
      // THEN
      await expect(client.sendData(testData)).resolves.not.toThrow();
    });

    test('times out after 2 seconds', async () => {
      // GIVEN
      const mockRequest = setupMockRequest();
      const endpoint = new URL('https://example.com/telemetry');
      const testData = { event: 'test' };
      const client = new TelemetryClient({ endpoint, localFilePath });
      
      // WHEN
      await client.sendData(testData);
      
      // THEN
      expect(mockRequest.setTimeout).toHaveBeenCalledWith(2000, expect.any(Function));
    });
  });

  describe('saveData', () => {
    test('saves data to a new file if file does not exist', async () => {
      // GIVEN
      const endpoint = new URL('https://example.com/telemetry');
      const testData = { event: 'test', properties: { foo: 'bar' } };
      const client = new TelemetryClient({ endpoint, localFilePath });
      setupMockRequest();
      
      // WHEN
      await client.sendData(testData);
      
      // THEN
      expect(fs.existsSync(localFilePath)).toBe(true);
      const fileContent = fs.readFileSync(localFilePath, 'utf8');
      const parsedContent = JSON.parse(fileContent);
      expect(parsedContent).toEqual([testData]);
    });

    test('appends to existing data in the file', async () => {
      // GIVEN
      const endpoint = new URL('https://example.com/telemetry');
      const existingData = [{ event: 'old_event' }];
      const testData = { event: 'new_event', properties: { foo: 'bar' } };
      setupMockRequest();
      
      fs.writeFileSync(localFilePath, JSON.stringify(existingData), 'utf8');
      const client = new TelemetryClient({ endpoint, localFilePath });
      
      // WHEN
      await client.sendData(testData);
      
      // THEN
      const fileContent = fs.readFileSync(localFilePath, 'utf8');
      const parsedContent = JSON.parse(fileContent);
      expect(parsedContent).toEqual([...existingData, testData]);
    });

    test('handles non-array JSON in existing file', async () => {
      // GIVEN
      const endpoint = new URL('https://example.com/telemetry');
      const existingData = { event: 'old_event' };
      const testData = { event: 'test' };
      setupMockRequest();
      
      fs.writeFileSync(localFilePath, JSON.stringify(existingData), 'utf8');
      const client = new TelemetryClient({ endpoint, localFilePath });
      
      // WHEN
      await client.sendData(testData);
      
      // THEN
      const fileContent = fs.readFileSync(localFilePath, 'utf8');
      const parsedContent = JSON.parse(fileContent);
      expect(parsedContent).toEqual([existingData, testData]);
    });

    test('handles invalid JSON in existing file', async () => {
      // GIVEN
      const endpoint = new URL('https://example.com/telemetry');
      const testData = { event: 'test' };
      setupMockRequest();
      
      fs.writeFileSync(localFilePath, 'invalid json', 'utf8');
      const client = new TelemetryClient({ endpoint, localFilePath });
      
      // WHEN
      await client.sendData(testData);
      
      // THEN
      const fileContent = fs.readFileSync(localFilePath, 'utf8');
      const parsedContent = JSON.parse(fileContent);
      expect(parsedContent).toEqual([testData]);
    });
  });
});
