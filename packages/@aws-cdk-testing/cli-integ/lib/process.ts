import * as child from 'child_process';
import type { Readable, Writable } from 'stream';
import * as pty from 'node-pty';

/**
 * IProcess provides an interface to work with a subprocess.
 */
export interface IProcess {

  /**
   * Register a callback to be invoked when a chunk is written to stdout.
   */
  onStdout(callback: (chunk: Buffer) => void): void;

  /**
   * Register a callback to be invoked when a chunk is written to stderr.
   */
  onStderr(callback: (chunk: Buffer) => void): void;

  /**
   * Register a callback to be invoked when the process exists.
   */
  onExit(callback: (exitCode: number) => void): void;

  /**
   * Register a callback to be invoked if the process failed to start.
   */
  onError(callback: (error: Error) => void): void;

  /**
   * Write the process stdin stream.
   */
  writeStdin(data: string): void;

  /**
   * Singal that no more data will be written to stdin. In non tty process you must
   * call this method to make sure the process exits.
   *
   * @param delay - optional delay in milliseconds before the signal is sent.
   *
   */
  endStdin(delay?: number): void;

}

export class Process {
  /**
   * Spawn a process with a TTY attached.
   */
  public static spawnTTY(command: string, args: string[], options: pty.IPtyForkOptions | pty.IWindowsPtyForkOptions = {}): IProcess {
    const process = pty.spawn(command, args, {
      name: 'xterm-color',
      ...options,
    });
    return new PtyProcess(process);
  }

  /**
   * Spawn a process without a forcing a TTY.
   */
  public static spawn(command: string, args: string[], options: child.SpawnOptions = {}): IProcess {
    const process = child.spawn(command, args, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    return new NonPtyProcess(process);
  }
}

class PtyProcess implements IProcess {
  public constructor(private readonly process: pty.IPty) {
  }

  public endStdin(_?: number): void {
    // not needed because all streams are the same in tty.
  }

  public onError(_: (error: Error) => void): void {
    // not needed because the pty.spawn will simply fail in this case.
  }

  public onStdout(callback: (chunk: Buffer) => void): void {
    this.process.onData((e) => callback(Buffer.from(e)));
  }

  public onStderr(_callback: (chunk: Buffer) => void): void {
    // https://github.com/microsoft/node-pty/issues/71
    throw new Error('Cannot register callback for \'stderr\'. A tty does not have separate output and error channels');
  }

  public onExit(callback: (exitCode: number) => void): void {
    this.process.onExit((e) => {
      callback(e.exitCode);
    });
  }

  public writeStdin(data: string): void {
    // in a pty all streams are the same
    this.process.write(data);
  }
}

class NonPtyProcess implements IProcess {
  public constructor(private readonly process: child.ChildProcess) {
  }

  public onError(callback: (error: Error) => void): void {
    this.process.once('error', callback);
  }

  public onStdout(callback: (chunk: Buffer) => void): void {
    this.assertDefined('stdout', this.process.stdout);
    this.process.stdout.on('data', callback);
  }

  public onStderr(callback: (chunk: Buffer) => void): void {
    this.assertDefined('stderr', this.process.stderr);
    this.process.stderr.on('data', callback);
  }

  public onExit(callback: (exitCode: number) => void): void {
    this.process.on('close', callback);
  }

  public writeStdin(content: string): void {
    this.assertDefined('stdin', this.process.stdin);
    this.process.stdin.write(content);
  }

  public endStdin(delay?: number): void {
    if (this.process.stdin == null) {
      throw new Error('No stdin defined for process');
    }
    if (delay) {
      setTimeout(() => this.process.stdin!.end(), delay);
    } else {
      this.process.stdin!.end();
    }
  }

  public assertDefined(name: 'stdin' | 'stdout' | 'stderr', stream?: Readable | Writable | undefined | null): asserts stream {
    if (stream == null) {
      throw new Error(`No ${name} defined for child process`);
    }
  }
}
