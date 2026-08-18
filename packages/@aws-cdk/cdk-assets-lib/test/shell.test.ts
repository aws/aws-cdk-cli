import { shell } from '../lib/private/shell';

describe('shell', () => {
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
});
