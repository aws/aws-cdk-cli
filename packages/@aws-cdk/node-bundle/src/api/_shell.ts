import * as child_process from 'child_process';

export interface ShellOptions {
  readonly cwd?: string;
  readonly quiet?: boolean;
}

/**
 * Execute a shell command with proper cross-platform support
 * @param command - The command to execute
 * @param args - The arguments to pass to the command
 * @param options - Additional options
 * @returns The command output
 */
export function shell(argv: string[], options: ShellOptions = {}): string {
  const stdio: child_process.StdioOptions = options.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'];
  const buffer = child_process.execFileSync(argv[0], argv.slice(1), {
    cwd: options.cwd,
    stdio: stdio,
  });
  return buffer ? buffer.toString('utf-8').trim() : '';
}
