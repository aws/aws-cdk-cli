import * as child_process from 'child_process';

export interface ShellOptions {
  readonly cwd?: string;
  readonly quiet?: boolean;
}

/**
 * Execute a shell command with proper cross-platform support
 * @param command The command to execute
 * @param args The arguments to pass to the command
 * @param options Additional options
 * @returns The command output
 */
export function shell(command: string, args: string[] = [], options: ShellOptions = {}): string {
  const stdio: child_process.StdioOptions = options.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'];
  const result = child_process.spawnSync(command, args, {
    cwd: options.cwd,
    stdio: stdio,
    encoding: 'utf-8',
  });
  
  if (result.error) {
    throw result.error;
  }
  
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${command} ${args.join(' ')}`);
  }
  
  return result.stdout ? result.stdout.trim() : '';
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use the version that takes command and args separately
 */
export function shell(command: string, options?: ShellOptions): string {
  // Simple splitting - in a real implementation you'd want to handle quoted arguments properly
  const parts = command.split(' ');
  const cmd = parts[0];
  const args = parts.slice(1);
  
  return shell(cmd, args, options);
}
