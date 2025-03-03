import { numberFromBool } from '../../src/util/bool';

test.each([
  [true, 1],
  [false, 0],
])('for %s returns %s', (value, expected) => {
  expect(numberFromBool(value)).toBe(expected);
});
