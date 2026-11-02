import * as path from 'path';
import { cliRootDir } from './root-dir';

export function versionWithBuild() {
  return `${versionNumber()} (build ${commit()})`;
}

export function isDeveloperBuildVersion(): boolean {
  try {
    return versionNumber() === '0.0.0';
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`Error determining build version: ${e}`);
    return false;
  }
}

export function versionNumber(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(cliRootDir(), 'package.json')).version.replace(/\+[0-9a-f]+$/, '');
}

function commit(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(cliRootDir(), 'build-info.json')).commit;
}
