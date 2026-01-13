import * as child_process from 'child_process';
import { execWithSubShell, renderCommand } from '../lib/utils';

jest.mock('child_process');

describe('execWithSubShell', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('executes simple command', () => {
    // GIVEN
    const mockSpawnSync = jest.spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: Buffer.from('output'),
      stderr: Buffer.from(''),
    } as any);

    // WHEN
    const result = execWithSubShell(['echo', 'hello']);

    // THEN
    expect(mockSpawnSync).toHaveBeenCalledWith('echo', ['hello'], expect.anything());
    expect(result).toBe('output');
  });

  test('executes command with subshell', () => {
    // GIVEN
    const mockSpawnSync = jest.spyOn(child_process, 'spawnSync')
      .mockImplementationOnce(() => ({
        status: 0,
        stdout: Buffer.from('subcommand-output'),
        stderr: Buffer.from(''),
      } as any))
      .mockImplementationOnce(() => ({
        status: 0,
        stdout: Buffer.from('main-output'),
        stderr: Buffer.from(''),
      } as any));

    // WHEN
    const result = execWithSubShell(['git', 'checkout', ['git', 'merge-base', 'HEAD'], '--', 'path/to/file']);

    // THEN
    // First call should be the subshell command
    expect(mockSpawnSync).toHaveBeenNthCalledWith(1, 'git', ['merge-base', 'HEAD'], expect.anything());
    // Second call should be the main command with the subshell output substituted
    expect(mockSpawnSync).toHaveBeenNthCalledWith(2, 'git', ['checkout', 'subcommand-output', '--', 'path/to/file'], expect.anything());
    expect(result).toBe('main-output');
  });

  test('executes command with nested subshells', () => {
    // GIVEN
    const mockSpawnSync = jest.spyOn(child_process, 'spawnSync')
      .mockImplementationOnce(() => ({
        status: 0,
        stdout: Buffer.from('nested-output'),
        stderr: Buffer.from(''),
      } as any))
      .mockImplementationOnce(() => ({
        status: 0,
        stdout: Buffer.from('subcommand-output'),
        stderr: Buffer.from(''),
      } as any))
      .mockImplementationOnce(() => ({
        status: 0,
        stdout: Buffer.from('main-output'),
        stderr: Buffer.from(''),
      } as any));

    // WHEN
    const result = execWithSubShell(['command', ['subcommand', ['nested', 'command']]]);

    // THEN
    // First call should be the nested subshell command
    expect(mockSpawnSync).toHaveBeenNthCalledWith(1, 'nested', ['command'], expect.anything());
    // Second call should be the subshell command with nested output substituted
    expect(mockSpawnSync).toHaveBeenNthCalledWith(2, 'subcommand', ['nested-output'], expect.anything());
    // Third call should be the main command with the subshell output substituted
    expect(mockSpawnSync).toHaveBeenNthCalledWith(3, 'command', ['subcommand-output'], expect.anything());
    expect(result).toBe('main-output');
  });

  test('throws error when command fails', () => {
    // GIVEN
    jest.spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 1,
      stdout: Buffer.from(''),
      stderr: Buffer.from('error message'),
    } as any);

    // THEN
    expect(() => execWithSubShell(['failing', 'command'])).toThrow('Command exited with status 1');
  });
});

describe('renderCommand', () => {
  test('renders simple command', () => {
    // WHEN
    const result = renderCommand(['echo', 'hello']);

    // THEN
    expect(result).toBe('echo hello');
  });

  test('renders command with subshell', () => {
    // WHEN
    const result = renderCommand(['git', 'checkout', ['git', 'merge-base', 'HEAD'], '--', 'path/to/file']);

    // THEN
    expect(result).toBe('git checkout $(git merge-base HEAD) -- path/to/file');
  });

  test('renders command with nested subshells', () => {
    // WHEN
    const result = renderCommand(['command', ['subcommand', ['nested', 'command']]]);

    // THEN
    expect(result).toBe('command $(subcommand $(nested command))');
  });

  test('handles empty arrays', () => {
    // WHEN
    const result = renderCommand([]);

    // THEN
    expect(result).toBe('');
  });
});
