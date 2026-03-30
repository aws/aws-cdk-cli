import { execInChildProcess } from '../../../lib/api/cloud-assembly/private/exec';

describe('execInChildProcess', () => {
  test('default event publisher appends newlines when writing to stdout and stderr', async () => {
    const stdoutWrites: string[] = [];
    const stderrWrites: string[] = [];

    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);

    process.stdout.write = ((chunk: any, ...args: any[]) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as any;

    process.stderr.write = ((chunk: any, ...args: any[]) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as any;

    try {
      await execInChildProcess('echo "hello from stdout" && echo "hello from stderr" >&2');
    } finally {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    }

    // Each line written to stdout should end with a newline (the fix adds '\n')
    expect(stdoutWrites).toContainEqual('hello from stdout\n');
    // Each line written to stderr should end with a newline (the fix adds '\n')
    expect(stderrWrites).toContainEqual('hello from stderr\n');
  });
});
