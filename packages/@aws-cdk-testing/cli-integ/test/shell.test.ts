import { MemoryStream } from '../lib/corking';
import { shell } from '../lib/shell';

describe('shell command timing', () => {
  // Commands are run through a shell, so they must not contain shell metacharacters
  const TIMING_LINE = /⏱️\s+\d+(\.\d+)?(ms|s)\s/;

  test('reports the duration of a successful command', async () => {
    const output = new MemoryStream();

    await shell([process.execPath, '--version'], { outputs: [output] });

    // The '💻' line announces the command, the '⏱️' line reports how long it took
    expect(output.toString()).toMatch(TIMING_LINE);
  });

  test('reports the duration of a failing command too', async () => {
    const output = new MemoryStream();

    await expect(
      shell([process.execPath, '--definitely-not-a-node-flag'], { outputs: [output] }),
    ).rejects.toThrow(/exited with error code/);

    expect(output.toString()).toMatch(TIMING_LINE);
  });
});
