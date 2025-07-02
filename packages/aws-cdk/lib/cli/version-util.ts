import * as path from 'path';
import { cliRootDir } from './root-dir';

export function displayVersion() {
  return `${versionNumber()} (build ${commit()})`;
}

export function isDeveloperBuild(): boolean {
  return versionNumber() === '0.0.0';
}

export function versionNumber(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(cliRootDir(), 'package.json')).version.replace(/\+[0-9a-f]+$/, '');
}

function commit(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(cliRootDir(), 'build-info.json')).commit;
}
