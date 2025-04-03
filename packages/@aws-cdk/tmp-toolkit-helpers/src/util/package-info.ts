import * as path from 'node:path';
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

export function packageAndVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgInfo = require(path.join(bundledPackageRootDir(__dirname), 'package.json'));
  const version = pkgInfo.version.replace(/\+[0-9a-f]+$/, '');
  const pkg = pkgInfo.name;

  return `${pkg}@${version}`;
}

export function displayPackageAndVersion(): string {
  return `${packageAndVersion()} (build ${commit()})`;
}
