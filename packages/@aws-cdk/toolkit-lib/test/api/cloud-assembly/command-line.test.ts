import { CommandLine } from '../../../lib/api/cloud-assembly/command-line';

//////////////////////////////////////////////////////////////////////////////////////////////
//  Windows
//

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
])('windows parses %s to %p', (input, expected) => {
  const output = CommandLine.parse(input, 'cmd.exe');

  expect(output.argv).toEqual(expected);
});

test.each([
  [['program.exe', 'with spaces'], 'program.exe "with spaces"'],
  [['C:\\Program Files\\node.exe', 'hello.js'], '"C:\\Program Files\\node.exe" hello.js'],
])('windows formats grouped %p to %p', (input, expected) => {
  const cmd = new CommandLine(input);
  expect(cmd.toStringGrouped('cmd.exe')).toEqual(expected);
});

//////////////////////////////////////////////////////////////////////////////////////////////
//  POSIX
//

test.each([
  ['program "arg with spaces" simple-arg', ['program', 'arg with spaces', 'simple-arg']],
  ['program \'arg with spaces\' simple-arg', ['program', 'arg with spaces', 'simple-arg']],
  ['program \\silly', ['program', 'silly']],
  ['program \\\\silly', ['program', '\\silly']],
  ['program \'"\'', ['program', '"']],
  ['program "\'"', ['program', '\'']],
  ['program as"d e"f', ['program', 'asd ef']],
])('POSIX parses %s to %p', (input, expected) => {
  const output = CommandLine.parse(input, 'posix');

  expect(output.argv).toEqual(expected);
});

test.each([
  [['program', 'with spaces'], 'program \'with spaces\''],
  [['/path with spaces', 'hello.js'], '\'/path with spaces\' hello.js'],
])('posix formats grouped %p to %p', (input, expected) => {
  const cmd = new CommandLine(input);
  expect(cmd.toStringGrouped('posix')).toEqual(expected);
});
