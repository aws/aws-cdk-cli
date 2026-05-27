import * as os from 'os';
import * as path from 'path';
import {
  socketPathForProject,
  lockPathForProject,
  infoPathForProject,
  logPathForProject,
} from '../../lib/daemon/socket-path';

describe('socket-path', () => {
  test('produces a path in the temp directory', () => {
    const result = socketPathForProject('/home/user/my-cdk-app');
    expect(result.startsWith(os.tmpdir())).toBe(true);
  });

  test('socket path has .sock extension', () => {
    const result = socketPathForProject('/project');
    expect(result).toMatch(/\.sock$/);
  });

  test('lock path appends .lock to socket path', () => {
    const project = '/home/user/app';
    expect(lockPathForProject(project)).toBe(socketPathForProject(project) + '.lock');
  });

  test('info path appends .info to socket path', () => {
    const project = '/home/user/app';
    expect(infoPathForProject(project)).toBe(socketPathForProject(project) + '.info');
  });

  test('log path appends .log to socket path', () => {
    const project = '/home/user/app';
    expect(logPathForProject(project)).toBe(socketPathForProject(project) + '.log');
  });

  test('same project always produces the same path', () => {
    const dir = '/home/user/my-cdk-app';
    expect(socketPathForProject(dir)).toBe(socketPathForProject(dir));
  });

  test('different projects produce different paths', () => {
    const a = socketPathForProject('/project-a');
    const b = socketPathForProject('/project-b');
    expect(a).not.toBe(b);
  });

  test('path contains cdk-synth- prefix', () => {
    const result = socketPathForProject('/anything');
    const basename = path.basename(result);
    expect(basename).toMatch(/^cdk-synth-/);
  });

  test('hash portion is 12 hex characters', () => {
    const result = socketPathForProject('/test');
    const basename = path.basename(result, '.sock');
    const hash = basename.replace('cdk-synth-', '');
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });
});
