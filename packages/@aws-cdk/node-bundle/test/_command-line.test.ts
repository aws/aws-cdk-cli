import { parseCommandLine } from '../lib/api/_command-line';

// Windows
test.each([
  ['program.exe "arg with spaces" simple-arg', ['program.exe', 'arg with spaces', 'simple-arg']],
  ['program.exe \\silly', ['program.exe', '\\silly']],
  // Edge cases from https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments?view=msvc-170
  ['"a b c" d e', ['a b c', 'd', 'e']],
  ['"ab\\"c" "\\\\" d', ['ab"c', '\\', 'd']],
  ['a\\\\\\b d"e f"g h', ['a\\\\\\b', 'de fg', 'h']],
  ['a\\\\\\"b c d', ['a\\"b', 'c', 'd']],
  ['a\\\\\\\\"b c" d e', ['a\\\\b c', 'd', 'e']],
  ['a"b"" c d', ['ab" c d']],
])('windows parses %s correctly', (input, expected) => {
  const output = parseCommandLine(input, true);

  expect(output).toEqual(expected);
});

// POSIX
test.each([
  ['program "arg with spaces" simple-arg', ['program', 'arg with spaces', 'simple-arg']],
  ['program \'arg with spaces\' simple-arg', ['program', 'arg with spaces', 'simple-arg']],
  ['program \\silly', ['program', 'silly']],
  ['program \\\\silly', ['program', '\\silly']],
  ['program \'"\'', ['program', '"']],
  ['program "\'"', ['program', '\'']],
  ['program as"d e"f', ['program', 'asd ef']],
])('POSIX parses %s correctly', (input, expected) => {
  const output = parseCommandLine(input, false);

  expect(output).toEqual(expected);
});
