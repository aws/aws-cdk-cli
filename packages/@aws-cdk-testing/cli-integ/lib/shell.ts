import type * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TestContext } from './integ-test';
import { Process } from './process';
import type { TemporaryDirectoryContext } from './with-temporary-directory';

/**
 * A shell command that does what you want
 *
 * Is platform-aware, handles errors nicely.
 */
export async function shell(command: string[], options: ShellOptions = {}): Promise<string> {
  if (options.modEnv && options.env) {
    throw new Error('Use either env or modEnv but not both');
  }

  const outputs = new Set(options.outputs);
  const writeToOutputs = (x: string) => {
    for (const outputStream of outputs) {
      outputStream.write(x);
    }
  };

  // Always output the command
  writeToOutputs(`💻 ${command.join(' ')}\n`);
  const show = options.show ?? 'always';

  const env = options.env ?? (options.modEnv ? { ...process.env, ...options.modEnv } : process.env);
  const tty = options.interact && options.interact.length > 0;

  // Coerce to `any` because `ShellOptions` contains custom properties
  // that don't exist in the underlying interfaces. We could either rebuild each options map,
  // or just pass through and let the underlying implemenation ignore what it doesn't know about.
  // We choose the lazy one.
  const spawnOptions = { ...options, env } as any;

  const child = tty
    ? Process.spawnTTY(command[0], command.slice(1), spawnOptions)
    : Process.spawn(command[0], command.slice(1), spawnOptions);

  // copy because we will be shifting it
  const remainingInteractions = [...(options.interact ?? [])];

  return new Promise<string>((resolve, reject) => {
    const stdout = new Array<Buffer>();
    const stderr = new Array<Buffer>();

    const lastLine = new LastLine();

    child.onStdout(chunk => {
      if (show === 'always') {
        writeToOutputs(chunk.toString('utf-8'));
      }
      stdout.push(chunk);
      lastLine.append(chunk.toString('utf-8'));

      const interaction = remainingInteractions[0];
      if (interaction) {
        if (interaction.prompt.test(lastLine.get())) {
          // subprocess expects a user input now.
          // first, shift the interactions to ensure the same interaction is not reused
          remainingInteractions.shift();

          // then, reset the last line to prevent repeated matches caused by tty echoing
          lastLine.reset();

          // now write the input with a slight delay to ensure
          // the child process has already started reading.
          setTimeout(() => {
            child.writeStdin(interaction.input + (interaction.end ?? os.EOL));
          }, 500);
        }
      }
    });

    if (tty && options.captureStderr === false) {
      // in a tty stderr goes to the same fd as stdout
      throw new Error('Cannot disable \'captureStderr\' in tty');
    }

    if (!tty) {
      // in a tty stderr goes to the same fd as stdout, so onStdout
      // is sufficient.
      child.onStderr(chunk => {
        if (show === 'always') {
          writeToOutputs(chunk.toString('utf-8'));
        }
        if (options.captureStderr ?? true) {
          stderr.push(chunk);
        }
      });
    }

    child.onError(reject);

    child.onExit(code => {
      const stderrOutput = Buffer.concat(stderr).toString('utf-8');
      const stdoutOutput = Buffer.concat(stdout).toString('utf-8');
      const out = (options.onlyStderr ? stderrOutput : stdoutOutput + stderrOutput).trim();

      const logAndreject = (error: Error) => {
        if (show === 'error') {
          writeToOutputs(`${out}\n`);
        }
        reject(error);
      };

      if (remainingInteractions.length !== 0) {
        // regardless of the exit code, if we didn't consume all expected interactions we probably
        // did somethiing wrong.
        logAndreject(new Error(`Expected more user interactions but subprocess exited with ${code}`));
        return;
      }

      if (code === 0 || options.allowErrExit) {
        resolve(out);
      } else {
        logAndreject(new Error(`'${command.join(' ')}' exited with error code ${code}.`));
      }
    });
  });
}

/**
 * Models a single user interaction with the shell.
 */
export interface UserInteraction {
  /**
   * The prompt to expect. Regex matched against the last line in
   * the output before the prompt is displayed.
   *
   * Most commonly this would be a simple string to match for inclusion.
   *
   * Examples:
   *
   * - Process Output: "Hey there! Are you sure?"
   *   Prompt: /Are you sure?/
   *   Match (Yes/No): Yes
   *   Reason: "Hey there! Are you sure?" ~ /Are you sure?/
   *
   * - Process Output: "Hey there!\nAre you sure?"
   *   Prompt: /Are you sure?/
   *   Match (Yes/No): Yes
   *   Reason: "Are you sure?" ~ /Are you sure?/
   *
   * - Process Output: "Are you sure?\n(remember this is destructive)"
   *   Prompt: /Are you sure?/
   *   Match (Yes/No): No
   *   Reason: "(remember this is destructive)" ≄ /Are you sure?/
   *
   * - Process Output: "Are you sure?\n(remember this is destructive)"
   *   Prompt: /remember this is destructive/
   *   Match (Yes/No): Yes
   *   Reason: "(remember this is destructive)" ~ /remember this is destructive/
   *
   */
  readonly prompt: RegExp;
  /**
   * The input to provide.
   */
  readonly input: string;

  /**
   * The string to signal the end of input.
   *
   * @default os.EOL
   */
  readonly end?: string;
}

export interface ShellOptions extends child_process.SpawnOptions {
  /**
   * Properties to add to 'env'
   */
  readonly modEnv?: Record<string, string | undefined>;

  /**
   * Don't fail when exiting with an error
   *
   * @default false
   */
  readonly allowErrExit?: boolean;

  /**
   * Whether to capture stderr
   *
   * @default true
   */
  readonly captureStderr?: boolean;

  /**
   * Pass output here
   */
  readonly outputs?: NodeJS.WritableStream[];

  /**
   * Only return stderr. For example, this is used to validate
   * that when CI=true, all logs are sent to stdout.
   *
   * @default false
   */
  readonly onlyStderr?: boolean;

  /**
   * Don't log to stdout
   *
   * @default always
   */
  readonly show?: 'always' | 'never' | 'error';

  /**
   * Provide user interaction to respond to shell prompts.
   *
   * Order and count should correspond to the expected prompts issued by the subprocess.
   */
  readonly interact?: UserInteraction[];

}

export class ShellHelper {
  public static fromContext(context: TestContext & TemporaryDirectoryContext) {
    return new ShellHelper(context.integTestDir, context.output);
  }

  constructor(
    private readonly _cwd: string,
    private readonly _output: NodeJS.WritableStream) {
  }

  public get dockerConfigDir() {
    return path.join(this._cwd, '.docker');
  }

  public async shell(command: string[], options: Omit<ShellOptions, 'cwd' | 'outputs'> = {}): Promise<string> {
    return shell(command, {
      outputs: [this._output],
      cwd: this._cwd,
      ...options,
      modEnv: {
        // give every shell its own docker config directory
        // so that parallel runs don't interfere with each other.
        DOCKER_CONFIG: this.dockerConfigDir,
        ...options.modEnv,
      },
    });
  }
}

/**
 * rm -rf reimplementation, don't want to depend on an NPM package for this
 *
 * Returns `true` if everything got deleted, or `false` if some files could
 * not be deleted due to permissions issues.
 */
export function rimraf(fsPath: string): boolean {
  try {
    let success = true;
    const isDir = fs.lstatSync(fsPath).isDirectory();

    if (isDir) {
      for (const file of fs.readdirSync(fsPath)) {
        success &&= rimraf(path.join(fsPath, file));
      }
      fs.rmdirSync(fsPath);
    } else {
      fs.unlinkSync(fsPath);
    }
    return success;
  } catch (e: any) {
    // Can happen if some files got generated inside a Docker container and are now inadvertently owned by `root`.
    // We can't ever clean those up anymore, but since it only happens inside GitHub Actions containers we also don't care too much.
    if (e.code === 'EACCES' || e.code === 'ENOTEMPTY') {
      return false;
    }

    // Already gone
    if (e.code === 'ENOENT') {
      return true;
    }

    throw e;
  }
}

export function addToShellPath(x: string) {
  const parts = process.env.PATH?.split(':') ?? [];

  if (!parts.includes(x)) {
    parts.unshift(x);
  }

  process.env.PATH = parts.join(':');
}

/**
 * Accumulate text since the last line break (or beginning of string) it has seen in the chunks.
 *
 * Examples:
 *
 * - Chunks: ['one\n', 'two\n', three']
 * - Last Line: 'three'
 *
 * - Chunks: ['one', 'two', '\nthree']
 * - Last Line: 'three'
 *
 * - Chunks: ['one', 'two']
 * - Last Line: 'onetwo'
 *
 * - Chunks: ['one', 'two', '\nthree', 'four']
 * - Last Line: 'threefour'
 */
class LastLine {
  private lastLine: string = '';

  public append(chunk: string): void {
    const lines = chunk.split(os.EOL);
    if (lines.length === 1) {
      // chunk doesn't contain a new line so just append
      this.lastLine += lines[0];
    } else {
      // chunk contains multiple lines so just override with the last one
      this.lastLine = lines[lines.length - 1];
    }
  }

  public get(): string {
    return this.lastLine;
  }

  public reset() {
    this.lastLine = '';
  }
}
