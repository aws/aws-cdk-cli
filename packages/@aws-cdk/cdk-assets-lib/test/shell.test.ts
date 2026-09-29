import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shell } from '../lib/private/shell';

describe('shell', () => {
  // Args after a *script file* are passed straight to process.argv, unlike
  // `node -e`, where node itself would reject a leading `--build-arg`.
  let scriptDir: string;
  const echoArgv = () => path.join(scriptDir, 'echo-argv.js');
  const exitNonZero = () => path.join(scriptDir, 'exit.js');

  beforeAll(() => {
    scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-test'));
    fs.writeFileSync(echoArgv(), 'process.stdout.write(process.argv.slice(2).join(" "))');
    fs.writeFileSync(exitNonZero(), 'process.exit(1)');
  });

  afterAll(() => {
    fs.rmSync(scriptDir, { recursive: true, force: true });
  });

  test('spawn failures propagate the OS error so callers can key off e.code', async () => {
    // docker.ts turns ENOENT into "please install docker" guidance; the
    // wrapper must not swallow the errno code into a generic ProcessFailed.
    await expect(
      shell(['this-binary-does-not-exist-xyz'], {
        shellEventPublisher: () => {
        },
        subprocessOutputDestination: 'ignore',
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });

  test('non-zero exits throw ProcessFailed with the exit code and stderr', async () => {
    await expect(
      shell([process.execPath, '-e', 'process.stderr.write("boom"); process.exit(3);'], {
        shellEventPublisher: () => {
        },
        subprocessOutputDestination: 'ignore',
      }),
    ).rejects.toThrow(expect.objectContaining({
      code: 'PROCESS_FAILED',
      exitCode: 3,
    }));
  });

  test('returns stdout on success', async () => {
    const output = await shell([process.execPath, '-e', 'process.stdout.write("hello")'], {
      shellEventPublisher: () => {
      },
      subprocessOutputDestination: 'ignore',
    });

    expect(output).toEqual('hello');
  });

  test('redacts flagged argument values in the logged command line but runs the real value', async () => {
    const events = new Array<[string, string]>();
    // The child echoes its own argv, proving the *real* value reached it.
    const output = await shell(
      [process.execPath, echoArgv(), '--build-arg', 'TOKEN=supersecret'],
      {
        shellEventPublisher: (type, message) => events.push([type, message]),
        subprocessOutputDestination: 'publish',
        redactFlags: ['--build-arg'],
      },
    );

    const open = events.find(([type]) => type === 'open')![1];
    expect(open).toContain('TOKEN=<redacted>');
    expect(open).not.toContain('supersecret');
    // The process still received the unmasked value.
    expect(output).toContain('TOKEN=supersecret');
  });

  test('redacts flagged values in the failure message too', async () => {
    const err = await shell(
      [process.execPath, exitNonZero(), '--build-arg', 'TOKEN=supersecret'],
      {
        shellEventPublisher: () => {
        },
        subprocessOutputDestination: 'ignore',
        redactFlags: ['--build-arg'],
      },
    ).catch((e) => e);

    expect(err.code).toEqual('PROCESS_FAILED');
    expect(err.exitCode).toEqual(1);
    expect(err.message).toContain('TOKEN=<redacted>');
    expect(err.message).not.toContain('supersecret');
  });
});
