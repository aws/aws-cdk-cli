import { VERSION } from '../lib';

test('package loads', () => {
  expect(VERSION).toBe('0.0.0');
});
