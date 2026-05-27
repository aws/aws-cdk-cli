import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

const SOCKET_PREFIX = 'cdk-synth-';
const HASH_LENGTH = 12;

function hashForProject(projectDir: string): string {
  return crypto.createHash('sha256').update(projectDir).digest('hex').slice(0, HASH_LENGTH);
}

export function socketPathForProject(projectDir: string): string {
  return path.join(os.tmpdir(), `${SOCKET_PREFIX}${hashForProject(projectDir)}.sock`);
}

export function lockPathForProject(projectDir: string): string {
  return socketPathForProject(projectDir) + '.lock';
}

export function infoPathForProject(projectDir: string): string {
  return socketPathForProject(projectDir) + '.info';
}

export function logPathForProject(projectDir: string): string {
  return socketPathForProject(projectDir) + '.log';
}
