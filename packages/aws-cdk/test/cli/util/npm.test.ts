import { checkIfDeprecated } from '../../../lib/cli/util/npm';

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

  describe('checkIfDeprecated', () => {
    test('returns null for non-deprecated version', async () => {
      mockedExec.mockResolvedValue({
        stdout: '',
        stderr: '',
      });

      const result = await checkIfDeprecated('2.1.0');

      expect(result).toBeNull();
      expect(mockedExec).toHaveBeenCalledWith('npm view aws-cdk@2.1.0 deprecated --silent', { timeout: 3000 });
    });

    test('returns deprecation message for deprecated version', async () => {
      const deprecationMessage = 'This version has been deprecated';
      mockedExec.mockImplementation(() => Promise.resolve({
        stdout: deprecationMessage,
        stderr: '',
      }));

      const result = await checkIfDeprecated('1.0.0');

      expect(result).toBe(deprecationMessage);
    });

    test('returns null when error occurs', async () => {
      mockedExec.mockImplementation(() => Promise.reject(new Error('npm error')));

      const result = await checkIfDeprecated('2.1.0');

      expect(result).toBeNull();
    });
  });
}); 