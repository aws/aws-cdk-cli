import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { OutputStream } from '../../lib/subprocess';
import { run, runSync, runUserCommandLine, renderForDisplay, resolveExecutable, SubprocessError } from '../../lib/subprocess';

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

  // Windows-only: a plain .exe (as in every nodeEval test above) never routes
  // through cmd.exe, so this is the one path where cross-spawn's escaping is
  // actually exercised. NOTE: CI has no Windows unit-test lane today (unit
  // tests run only on the Ubuntu `build` job; the Windows CI jobs run the
  // black-box integ suites), so this currently executes only when the suite is
  // run on a Windows dev machine. It is kept as an executable spec until a
  // Windows unit-test lane exists.
  (process.platform === 'win32' ? test : test.skip)(
    'a .cmd shim receives hostile arguments verbatim (cross-spawn escaping)',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-shim'));
      const shim = path.join(dir, 'echo-args.cmd');
      // The shim forwards its args to node, which echoes them back as JSON.
      fs.writeFileSync(shim, '@node -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" %*\r\n');
      try {
        // Every one of these would do something (or break) if cmd.exe parsed it.
        const hostile = ['a&echo PWNED', 'b|whoami', 'c>out', 'd"q', '%PATH%', 'e^f', '(g)', 'two  spaces'];
        const result = await run([shim, ...hostile]);
        expect(JSON.parse(result.stdout)).toEqual(hostile);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    30000,
  );

  test('multi-byte UTF-8 characters split across chunks decode correctly', async () => {
    // 'é' is 2 bytes in UTF-8; the child writes them in separate chunks with a
    // delay so they arrive as separate 'data' events.
    const result = await run(nodeEval(
      "const b = Buffer.from('é', 'utf-8'); process.stdout.write(b.subarray(0, 1)); setTimeout(() => process.stdout.write(b.subarray(1)), 50);",
    ));

    expect(result.stdout).toEqual('é');
    expect(result.stdout).not.toContain('�');
  });

  test('does not crash on EPIPE when the child exits before draining stdin', async () => {
    // 10 MiB exceeds the OS pipe buffer, so the write is still in flight when
    // the child exits; the resulting EPIPE must not become an uncaughtException.
    const result = await run(nodeEval('process.exit(0)'), { input: 'x'.repeat(10 * 1024 * 1024) });

    expect(result.stdout).toEqual('');
  }, 15000);

  test('collect: false streams output without retaining it', async () => {
    const seen = new Array<string>();
    const result = await run(
      nodeEval('process.stdout.write("streamed");'),
      { collect: false, onOutput: (_stream, data) => seen.push(data) },
    );

    expect(seen.join('')).toEqual('streamed');
    expect(result.stdout).toEqual('');
  });

  test('inherit-stderr pipes stdout but not stderr', async () => {
    const result = await run(nodeEval('process.stdout.write("out");'), { stdio: 'inherit-stderr' });

    expect(result.stdout).toEqual('out');
    expect(result.stderr).toEqual('');
  });

  describe('SubprocessError.kind', () => {
    test("is 'exited' for a non-zero exit", async () => {
      await expect(run(nodeEval('process.exit(2)'))).rejects.toThrow(
        expect.objectContaining({ kind: 'exited', exitCode: 2 }),
      );
    });

    test("is 'killed' for a timeout", async () => {
      await expect(
        run(nodeEval('setTimeout(() => {}, 60000);'), { timeoutMs: 200 }),
      ).rejects.toThrow(expect.objectContaining({ kind: 'killed', signal: 'SIGTERM' }));
    }, 10000);

    test("is 'spawn-failed' for a missing executable", async () => {
      await expect(run(['this-command-does-not-exist-anywhere'])).rejects.toThrow(
        expect.objectContaining({ kind: 'spawn-failed', exitCode: null, signal: null }),
      );
    });
  });
});

describe('runSync', () => {
  test("reports a timeout as 'killed', not as a spawn failure", () => {
    expect(() => runSync(nodeEval('setTimeout(() => {}, 60000)'), { timeoutMs: 300 })).toThrow(
      expect.objectContaining({ kind: 'killed', signal: 'SIGTERM' }),
    );
  }, 10000);

  test('returns stdout on success', () => {
    expect(runSync(nodeEval('process.stdout.write("sync out")'))).toEqual('sync out');
  });

  test("reports a missing executable as 'spawn-failed'", () => {
    expect(() => runSync(['this-command-does-not-exist-anywhere'])).toThrow(
      expect.objectContaining({ kind: 'spawn-failed' }),
    );
  });
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

describe('resolveExecutable', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-exe'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('POSIX leaves a bare name unchanged (execvp already searches PATH only)', () => {
    expect(resolveExecutable('docker', { platform: 'linux' })).toEqual('docker');
  });

  test('an explicit path is honored verbatim on every platform', () => {
    expect(resolveExecutable('/usr/bin/docker', { platform: 'win32' })).toEqual('/usr/bin/docker');
    expect(resolveExecutable('C:\\tools\\docker.exe', { platform: 'win32' })).toEqual('C:\\tools\\docker.exe');
    expect(resolveExecutable('./local-tool', { platform: 'linux' })).toEqual('./local-tool');
  });

  test('Windows resolves a bare name to its absolute location on PATH', () => {
    const target = path.join(dir, 'docker.CMD');
    fs.writeFileSync(target, '');

    expect(resolveExecutable('docker', { platform: 'win32', env: { PATH: dir, PATHEXT: '.CMD' } }))
      .toEqual(target);
  });

  test('Windows searches for an already-suffixed name exactly (no double extension)', () => {
    // Casing kept consistent so the assertion is meaningful on a case-sensitive
    // filesystem; on Windows the FS match is itself case-insensitive.
    fs.writeFileSync(path.join(dir, 'tool.exe'), '');

    expect(resolveExecutable('tool.exe', { platform: 'win32', env: { PATH: dir, PATHEXT: '.EXE' } }))
      .toEqual(path.join(dir, 'tool.exe'));
  });

  test('Windows refuses a name that is not on PATH — never falls back to the cwd', () => {
    // The binary exists on disk, but in a directory that is NOT on PATH.
    // Resolution must fail rather than let Windows satisfy the bare name from
    // the working directory (the shadowing risk this closes).
    fs.writeFileSync(path.join(dir, 'docker.CMD'), '');

    expect(resolveExecutable('docker', { platform: 'win32', env: { PATH: '', PATHEXT: '.CMD' } }))
      .toBeUndefined();
  });

  test('Windows PATH lookup is case-insensitive in the env var name (Path vs PATH)', () => {
    const target = path.join(dir, 'git.EXE');
    fs.writeFileSync(target, '');

    expect(resolveExecutable('git', { platform: 'win32', env: { Path: dir, PATHEXT: '.EXE' } }))
      .toEqual(target);
  });

  test('Windows skips a relative PATH entry — the cwd is never consulted', () => {
    // A relative entry (classically `.`) would join into a non-absolute
    // candidate that cross-spawn re-resolves against the child cwd, reopening
    // the shadowing hole. It must be ignored; the absolute entry wins, and the
    // result is always absolute.
    const target = path.join(dir, 'docker.CMD');
    fs.writeFileSync(target, '');

    const resolved = resolveExecutable('docker', {
      platform: 'win32',
      env: { PATH: `.${path.delimiter}${dir}`, PATHEXT: '.CMD' },
    });

    expect(resolved).toEqual(target);
    expect(path.isAbsolute(resolved!)).toBe(true);
  });

  test('Windows resolves nothing when PATH holds only relative entries', () => {
    // Even though a matching file could exist relative to the cwd, a PATH of
    // only relative entries must never satisfy the name from the cwd.
    expect(resolveExecutable('docker', { platform: 'win32', env: { PATH: `.${path.delimiter}tools`, PATHEXT: '.CMD' } }))
      .toBeUndefined();
  });

  test('Windows unwraps double-quoted PATH entries (as which does)', () => {
    // Windows PATH entries may be wrapped in quotes (e.g. paths with spaces).
    const target = path.join(dir, 'docker.CMD');
    fs.writeFileSync(target, '');

    expect(resolveExecutable('docker', { platform: 'win32', env: { PATH: `"${dir}"`, PATHEXT: '.CMD' } }))
      .toEqual(target);
  });

  test('Windows probes a suffixed name exactly even when its extension is not in PATHEXT', () => {
    // `tool.exe` under `PATHEXT=.CMD` must still be found as `tool.exe`, not
    // only as `tool.exe.CMD`.
    fs.writeFileSync(path.join(dir, 'tool.exe'), '');

    expect(resolveExecutable('tool.exe', { platform: 'win32', env: { PATH: dir, PATHEXT: '.CMD' } }))
      .toEqual(path.join(dir, 'tool.exe'));
  });

  test('Windows probes a dotted name exactly (no known extension)', () => {
    // A name containing a dot may be a literal file on PATH; it is tried before
    // any PATHEXT extension is appended.
    fs.writeFileSync(path.join(dir, 'my.tool'), '');

    expect(resolveExecutable('my.tool', { platform: 'win32', env: { PATH: dir, PATHEXT: '.CMD' } }))
      .toEqual(path.join(dir, 'my.tool'));
  });
});
