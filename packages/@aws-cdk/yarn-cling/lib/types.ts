export interface PackageJson {
  name: string;
  version: string;

  /**
   * Dependency name to version range
   */
  dependencies?: Record<string, string>;
}

export interface YarnLock {
  type: string;
  /**
   * Dependency range (pkg@^1.2.0) to resolved package
   */
  object: Record<string, ResolvedYarnPackage>;
}

export interface ResolvedYarnPackage {
  version: string;
  resolved?: string;
  integrity?: string;

  /**
   * Dependency name to version range
   */
  dependencies?: Record<string, string>;
}

/**
 * The root of a package-lock file
 */
export interface PackageLockFile {
  name: string;
  lockfileVersion: 1;
  requires: true;
  version: string;
  /**
   * Package name to resolved package
   */
  dependencies?: Record<string, PackageLockPackage | 'moved'>;
}

/**
 * The entries in a package-lock file
 */
export interface PackageLockPackage {
  version: string;
  /**
   * Package name to resolved package
   */
  dependencies?: Record<string, PackageLockPackage | 'moved'>;
  resolved?: string;
  integrity?: string;

  /**
   * Package name to version number
   *
   * Must be in 'dependencies' at this level or higher.
   */
  requires?: Record<string, string>;

  bundled?: boolean;
  dev?: boolean;
  optional?: boolean;
}

export type PackageLockTree = PackageLockFile | PackageLockPackage;

export function iterDeps(tree: PackageLockTree): Array<[string, PackageLockPackage]> {
  return Object.entries(tree.dependencies ?? {})
    .flatMap(([name, pkg]) => isPackage(pkg) ? [[name, pkg]] : []);
}

export function isPackage(x: PackageLockPackage | 'moved' | undefined): x is PackageLockPackage {
  return !!x && x !== 'moved';
}
