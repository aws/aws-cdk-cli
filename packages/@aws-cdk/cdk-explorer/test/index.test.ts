import { startServer } from '../lib';

test('package exports startServer', () => {
  expect(typeof startServer).toBe('function');
});
