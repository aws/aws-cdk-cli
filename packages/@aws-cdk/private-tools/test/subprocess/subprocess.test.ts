import type { OutputStream } from '../../lib/subprocess';
import { run, runUserCommandLine, renderForDisplay, SubprocessError } from '../../lib/subprocess';

// A cross-platform argv that echoes its arguments exactly as received,
// proving no shell interpreted them. `node -e` exists everywhere the
// test suite runs, on all platforms, without shims.
function nodeEval(script: string): string[] {
  return [process.execPath, '-e', script];
}

describe('run', () => {
  test('collects stdout and stderr and resolves on exit 0', async () => {
    const result = await run(nodeEval('process.stdout.write("out"); process.stderr.write("err");'));

    expect(result.stdout).toEqual('out');
    expect(result.stderr).toEqual('err');
  });

  test('rejects with SubprocessError carrying exit code and collected output', async () => {
    await expect(run(nodeEval('process.stderr.write("boom"); process.exit(3);'))).rejects.toThrow(
      expect.objectContaining({
        code: 'SUBPROCESS_FAILED',
        exitCode: 3,
        signal: null,
        stderr: 'boom',
      }),
    );
  });

  test('rejects with SubprocessError when the executable does not exist', async () => {
    await expect(run(['this-command-does-not-exist-anywhere'])).rejects.toThrow(SubprocessError);
    await expect(run(['this-command-does-not-exist-anywhere'])).rejects.toThrow(/failed to start/);
  });

  test('throws on empty argv', async () => {
    await expect(run([])).rejects.toThrow(/non-empty argv/);
  });

  test('arguments are NOT shell-interpreted: metacharacters arrive verbatim', async () => {
    // Every character in here would be mangled by sh or cmd.exe. If any shell
    // touches the argv, the roundtrip fails.
    const hostile = ['foo;whoami', 'a&&b', '$(rm -rf /)', '`id`', 'a|b', '<in', '>out', '(paren)', '%PATH%', '^caret', 'two  spaces'];
    const result = await run(nodeEval('process.stdout.write(JSON.stringify(process.argv.slice(1)))').concat(hostile));

    expect(JSON.parse(result.stdout)).toEqual(hostile);
  });

  test('pipes input to stdin', async () => {
    const result = await run(
      nodeEval('process.stdin.pipe(process.stdout);'),
      { input: 'hello stdin' },
    );

    expect(result.stdout).toEqual('hello stdin');
  });

  test('respects cwd', async () => {
    const result = await run(nodeEval('process.stdout.write(process.cwd());'), { cwd: __dirname });

    expect(result.stdout).toEqual(__dirname);
  });

  test('passes env', async () => {
    const result = await run(
      nodeEval('process.stdout.write(process.env.SUBPROC_TEST ?? "unset");'),
      { env: { ...process.env, SUBPROC_TEST: 'value' } },
    );

    expect(result.stdout).toEqual('value');
  });

  test('kills the child on timeout and reports the signal', async () => {
    await expect(
      run(nodeEval('setTimeout(() => {}, 60000);'), { timeoutMs: 200 }),
    ).rejects.toThrow(
      expect.objectContaining({
        exitCode: null,
        signal: 'SIGTERM',
      }),
    );
  }, 10000);

  test('onOutput receives chunks with their stream', async () => {
    const events = new Array<[OutputStream, string]>();
    await run(
      nodeEval('process.stdout.write("o"); process.stderr.write("e");'),
      { onOutput: (stream, data) => events.push([stream, data]) },
    );

    expect(events).toContainEqual(['stdout', 'o']);
    expect(events).toContainEqual(['stderr', 'e']);
  });

  test('line buffering delivers whole lines and flushes the unterminated tail', async () => {
    const lines = new Array<string>();
    await run(
      nodeEval('process.stdout.write("one\\ntwo\\nthr"); setTimeout(() => process.stdout.write("ee\\nresidue"), 50);'),
      {
        buffering: 'lines',
        onOutput: (_stream, line) => lines.push(line),
      },
    );

    expect(lines).toEqual(['one', 'two', 'three', 'residue']);
  });

  test('runs .cmd shims on Windows via cross-spawn (npm --version)', async () => {
    // On patched Node, spawning npm without a shell throws EINVAL unless the
    // cmd.exe indirection is handled. This exercises cross-spawn's fix on
    // Windows; on POSIX it degrades to a plain spawn of the npm binary.
    const result = await run(['npm', '--version']);

    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 30000);
});

describe('runUserCommandLine', () => {
  test('shell features work: the command line is a shell script', async () => {
    const result = await runUserCommandLine('echo one && echo two');

    expect(result.stdout).toMatch(/one[\s\S]*two/);
  });

  test('rejects with SubprocessError on non-zero exit', async () => {
    await expect(runUserCommandLine('exit 4')).rejects.toThrow(
      expect.objectContaining({ exitCode: 4 }),
    );
  });
});

describe('renderForDisplay', () => {
  describe('posix', () => {
    const render = (argv: string[]) => renderForDisplay(argv, 'linux');

    test('safe arguments pass through unquoted', () => {
      expect(render(['docker', 'build', '-t', 'my-image:1.0', './ctx'])).toEqual('docker build -t my-image:1.0 ./ctx');
    });

    test.each([
      [';'], ['|'], ['<'], ['>'], ['('], [')'], ['`'], ['*'], ['&'], ['$'], ['^'], ['!'], ['"'], [' '], ['\\'],
    ])('argument containing %j gets quoted', (ch) => {
      const rendered = render([`a${ch}b`]);
      expect(rendered).toEqual(`'a${ch}b'`);
    });

    test('embedded single quotes survive quoting', () => {
      expect(render(["it's"])).toEqual("'it'\"'\"'s'");
    });
  });

  describe('windows', () => {
    const render = (argv: string[]) => renderForDisplay(argv, 'win32');

    test('safe arguments pass through unquoted', () => {
      expect(render(['docker', 'build', '-t', 'my-image:1.0'])).toEqual('docker build -t my-image:1.0');
    });

    test.each([
      [';'], ['|'], ['<'], ['>'], ['('], [')'], ['&'], ['^'], ['%'], [' '], ['"'],
    ])('argument containing %j gets quoted', (ch) => {
      const rendered = render([`a${ch}b`]);
      expect(rendered.startsWith('"')).toBe(true);
      expect(rendered.endsWith('"')).toBe(true);
    });

    test('embedded double quotes are escaped', () => {
      expect(render(['say "hi"'])).toEqual('"say \\"hi\\""');
    });

    test('trailing backslashes are doubled so the closing quote survives', () => {
      expect(render(['C:\\Program Files\\'])).toEqual('"C:\\Program Files\\\\"');
    });
  });

  test('defaults to the current platform', () => {
    expect(renderForDisplay(['plain'])).toEqual('plain');
  });
});
