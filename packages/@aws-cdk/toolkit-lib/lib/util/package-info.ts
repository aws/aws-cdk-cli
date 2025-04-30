import * as path from 'path';
import { bundledPackageRootDir } from './directories';

export function displayVersion() {
  return `${versionNumber()} (build ${commit()})`;
}

export function isDeveloperBuild(): boolean {
  return versionNumber() === '0.0.0';
}

export function versionNumber(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(bundledPackageRootDir(__dirname), 'package.json')).version.replace(/\+[0-9a-f]+$/, '');
}

function commit(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(bundledPackageRootDir(__dirname), 'build-info.json')).commit;
}
