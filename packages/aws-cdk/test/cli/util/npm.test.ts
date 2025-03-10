import { execNpmView } from '../../../lib/cli/util/npm';

jest.mock('util', () => {
  const mockExec = jest.fn();
  const format = jest.fn((fmt, ...args) => {
    return [fmt, ...args].join(' ');
  });
  return {
    promisify: jest.fn(() => mockExec),
    __mockExec: mockExec, 
    format,
  };
});

const { __mockExec: mockedExec } = jest.requireMock('util');

describe('npm.ts', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('execNpmView', () => {
    test('returns version, deprecated and name message', async () => {
      mockedExec.mockResolvedValue({
        stdout: '{"version": "0.0.0","deprecated": "This version has been deprecated.", "name": "aws-cdk"}',
        stderr: '',
      });

      const result = await execNpmView('0.0.0');

      expect(result).toEqual({
        version: '0.0.0',
        deprecated: 'This version has been deprecated.',
        name: 'aws-cdk',
      });
    }); 
    test('returns no deprecated field', async () => {
      mockedExec.mockResolvedValue({
        stdout: '{"version": "1.0.0", "name": "aws-cdk"}',
        stderr: '',
      });

      const result = await execNpmView('1.0.0');

      expect(result).toEqual({
        version: '1.0.0',
        name: 'aws-cdk',
      });
      expect(result.deprecated).toBeUndefined();
    }); 
    test('throws error when npm command fails', async () => {
      mockedExec.mockRejectedValue(new Error('npm ERR! code E404\nnpm ERR! 404 Not Found'));

      await expect(execNpmView('1.0.0')).rejects.toThrow();
    });
  });
}); 