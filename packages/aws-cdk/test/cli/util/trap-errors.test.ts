import { trapErrors } from '../../../lib/cli/util/trap-errors';

const mockDebug = jest.fn();
const ioHelper = {
  defaults: { debug: mockDebug },
} as any;

beforeEach(() => {
  mockDebug.mockReset();
});

test('does not throw when callback throws', async () => {
  await expect(trapErrors(ioHelper, 'oops', async () => {
    throw new Error('boom');
  })).resolves.toBeUndefined();
});

test('logs message and error as debug', async () => {
  await trapErrors(ioHelper, 'oops', async () => {
    throw new Error('boom');
  });
  expect(mockDebug).toHaveBeenCalledWith('oops: Error: boom');
});

test('returns callback result on success', async () => {
  const result = await trapErrors(ioHelper, 'oops', async () => 42);
  expect(result).toBe(42);
  expect(mockDebug).not.toHaveBeenCalled();
});
