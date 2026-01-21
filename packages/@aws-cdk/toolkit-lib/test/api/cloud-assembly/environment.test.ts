import * as fs from 'fs-extra';
import { guessExecutable } from '../../../lib/api/cloud-assembly/environment';

const BOTH = 'both' as const;
const DONTCARE = 'DONT-CARE';

test.each([
  // Just a simple command
  ...explodeBoth(['asdf', BOTH, 'asdf', BOTH, DONTCARE, 'asdf']),
  ...explodeBoth(['asdf', BOTH, 'asdf', undefined, DONTCARE, 'asdf']),
  // Simple command with args
  ...explodeBoth(['asdf arg', BOTH, 'asdf', BOTH, DONTCARE, 'asdf arg']),
  ...explodeBoth(['asdf arg', BOTH, 'asdf', undefined, DONTCARE, 'asdf arg']),
  // If the full path contains spaces and it's a file, quote it and execute it
  ...explodeBoth(['/path with/spaces', BOTH, '/path with/spaces', BOTH, DONTCARE, '"/path with/spaces"']),
  ...explodeBoth(['/path with/spaces', BOTH, '/path with/spaces', BOTH, DONTCARE, '"/path with/spaces"']),
  // If the path is a .js file on Windows, prepend the node interpreter (quoted if necessary)
  ...explodeBoth(['/path with/spaces.js', true, '/path with/spaces.js', BOTH, '/path/to/node', '/path/to/node "/path with/spaces.js"']),
  ...explodeBoth(['/path with/spaces.js', true, '/path with/spaces.js', BOTH, '/path to/node', '"/path to/node" "/path with/spaces.js"']),
  // If the path is a non-executable .js file on Linux, prepend the node interpreter (quoted if necessary)
  ...explodeBoth(['/path with/spaces.js', false, '/path with/spaces.js', false, '/path/to/node', '/path/to/node "/path with/spaces.js"']),
  ...explodeBoth(['/path with/spaces.js', false, '/path with/spaces.js', false, '/path to/node', '"/path to/node" "/path with/spaces.js"']),
  // If the path is an executable .js file on Linux, don't do anything (perhaps except quoting)
  ...explodeBoth(['/path/file.js', false, '/path/file.js', true, '/path/to/node', '/path/file.js']),
  ...explodeBoth(['/path with spaces/file.js', false, '/path with spaces/file.js', true, '/path to/node', '"/path with spaces/file.js"']),
  // If the path is quoted with spaces that also works
  ...explodeBoth(['"command with spaces" arg1 arg2', BOTH, 'command with spaces', BOTH, DONTCARE, '"command with spaces" arg1 arg2']),
  ...explodeBoth(['"command with spaces.js" arg1 arg2', true, 'command with spaces.js', false, '/node', '/node "command with spaces.js" arg1 arg2']),
])('cmd=%p win=%p (stat=%p) exe=%p node=%p => %p', async (commandLine: string, isWindows: boolean, statFile: string, isExecutable: boolean | undefined, nodePath: string, expected: string) => {
  // GIVEN
  process.execPath = nodePath;
  Object.defineProperty(process, 'platform', { value: isWindows ? 'win32' : 'linux' }) ;
  jest.spyOn(fs, 'stat').mockImplementation((p) => {
    if (p !== statFile) {
      throw new Error(`Expected a stat() call on '${statFile}' but got '${p}'`);
    }
    if (isExecutable === undefined) {
      const e = new Error(`No such file: ${p}`);
      (e as any).code = 'ENOENT';
      return Promise.reject(e);
    }
    return Promise.resolve({
      mode: isExecutable ? fs.constants.X_OK : 0,
    });
  });

  // WHEN
  const actual = await guessExecutable(commandLine, (_) => Promise.resolve());

  // THEN
  expect(actual).toEqual(expected);
});


/**
 * Explode all 'both's in a test array to both false and true
 */
function explodeBoth<F extends unknown, R extends unknown[]>(input: [F, ...R]): [NotBoth<F>, ...NotBothA<R>][] {
  const [first, ...rest] = input;

  const values = first === 'both' ? [false, true] : [first];

  if (rest.length === 0) {
    return [values as any];
  }
  const explodedRest = explodeBoth(rest as any);

  const ret: [NotBoth<F>, ...NotBothA<R>][]  = [];
  for (const value of values) {
    for (const remainder of explodedRest) {
      ret.push([value as any, ...remainder] as any);
    }
  }

  return ret;
}

type NotBoth<A> = Exclude<A, 'both'>;
type NotBothA<A extends unknown[]> = { [I in keyof A]: NotBoth<A[I]> };