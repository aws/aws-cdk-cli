import { promises as fs, exists } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as lockfile from '@yarnpkg/lockfile';
import * as semver from 'semver';
import { hoistDependencies } from './hoisting';
import { isPackage, iterDeps, type PackageJson, type PackageLockFile, type PackageLockPackage, type PackageLockTree, type YarnLock } from './types';

export interface ShrinkwrapOptions {
  /**
   * The package.json file to start scanning for dependencies
   */
  packageJsonFile: string;

  /**
   * The output lockfile to generate
   *
   * @default - Don't generate the file, just return the calculated output
   */
  outputFile?: string;

  /**
   * Whether to hoist dependencies
   *
   * @default true
   */
  hoist?: boolean;
}

export async function generateShrinkwrap(options: ShrinkwrapOptions): Promise<PackageLockFile> {
  // No args (yet)
  const packageJsonFile = options.packageJsonFile;
  const packageJsonDir = path.dirname(packageJsonFile);

  const yarnLockLoc = await findYarnLock(packageJsonDir);
  const yarnLock: YarnLock = lockfile.parse(await fs.readFile(yarnLockLoc, { encoding: 'utf8' }));
  const pkgJson = await loadPackageJson(packageJsonFile);

  let lock = await generateLockFile(pkgJson, yarnLock, packageJsonDir);

  if (options.hoist ?? true) {
    lock = hoistDependencies(lock);
  }

  _validateTree(lock);

  if (options.outputFile) {
    // Write the shrinkwrap file
    await fs.writeFile(options.outputFile, JSON.stringify(lock, undefined, 2), { encoding: 'utf8' });
  }

  return lock;
}

async function generateLockFile(pkgJson: PackageJson, yarnLock: YarnLock, rootDir: string): Promise<PackageLockFile> {
  const builder = new PackageGraphBuilder(yarnLock);
  const rootKeys = await builder.buildGraph(pkgJson.dependencies || {}, rootDir);

  const lockFile: PackageLockFile = {
    name: pkgJson.name,
    version: pkgJson.version,
    lockfileVersion: 1,
    requires: true,
    dependencies: builder.makeDependencyTree(rootKeys),
  };

  try {
    checkRequiredVersions(lockFile);
  } catch (e: any) {
    const tempFile = path.join(os.tmpdir(), 'npm-shrinkwrap.json');
    await fs.writeFile(tempFile, JSON.stringify(lockFile, undefined, 2), 'utf-8');
    throw new Error(`${e.message}. Shinkwrap file left in ${tempFile}.`);
  }

  return lockFile;
}

class PackageGraphBuilder {
  public readonly graph = new PackageGraph();
  private readonly reportedCycles = new Set<string>();

  constructor(private readonly yarnLock: YarnLock) {
  }

  public buildGraph(deps: Record<string, string>, rootDir: string) {
    return this.resolveMap(deps, rootDir, ['root']);
  }

  /**
   * Render the tree by starting from the root keys and recursing.
   * go without conflicting
   */
  public makeDependencyTree(rootKeys: string[]): Record<string, PackageLockPackage> {
    // A shadow tree of { package -> scope }
    const scopeTree = new Map<PackageLockPackage, {
      parent?: PackageLockPackage;
      name: string;
      consumed: Set<string>;
    }>();

    const root: PackageLockPackage = {
      version: '*',
      dependencies: {},
    };
    scopeTree.set(root, { name: 'root', consumed: new Set() });

    type Scope = NonNullableKeys<ReturnType<typeof scopeTree.get>>;

    // Queue of ids and parents where they should be inserted
    const queue: Array<[string, PackageLockPackage]> = rootKeys.map(key => [key, root]);

    while (queue.length > 0) {
      const [nextId, consumerPkg] = queue.shift()!;
      const [name, pkg] = this.graph.node(nextId);

      const consumerScope = scopeTree.get(consumerPkg)!;

      // --- Step 1: find a place to provide this package anywhere up the tree -----------
      if (versionInScope(consumerPkg, name) !== pkg.version) {
        const packageObject = { ...pkg }; // Make a copy for safety

        // Otherwise insert the dependency as high up as it'll go without conflicting with other consumed packages
        let finalParent = consumerPkg;
        let finalParentScope = consumerScope;

        // Push that dependency up as far as it'll go (leaving a trail of 'inScope's)
        while (finalParentScope.parent && !scopeTree.get(finalParentScope.parent)!.consumed.has(name)) {
          finalParent = finalParentScope.parent;
          finalParentScope = scopeTree.get(finalParent)!;
        }

        // Record location
        if (finalParent.dependencies?.[name]) {
          throw new Error('ruh-roh, conflict!');
        }

        finalParent.dependencies = {
          ...finalParent.dependencies,
          [name]: packageObject,
        };
        const newPackageScope: Scope = { name: nextId, parent: finalParent, consumed: new Set() };
        scopeTree.set(packageObject, newPackageScope);

        // Add the current package's dependencies to itself
        for (const child of this.graph.edges(nextId)) {
          queue.push([child, packageObject]);
        }
      }

      // ---- Step 2, regardless of whether we add a producer or not: mark this consumed all the way up to the root ----------
      let consumingScope: Scope | undefined = consumerScope;
      while (consumingScope) {
        consumingScope.consumed.add(name);
        consumingScope = consumingScope.parent ? scopeTree.get(consumingScope.parent) : undefined;
      }
    }

    return Object.fromEntries(iterDeps(root));

    function versionInScope(p: PackageLockPackage, name: string): string | undefined {
      let x: PackageLockPackage | undefined = p;
      while (x) {
        if (isPackage(x.dependencies?.[name])) {
          return x.dependencies[name].version;
        }

        x = scopeTree.get(x)?.parent;
      }
      return undefined;
    }
  }

  private async resolveMap(deps: Record<string, string>, searchDir: string, rootPath: string[]): Promise<string[]> {
    const ret: string[] = [];
    for (const [depName, versionRange] of Object.entries(deps)) {
      const child = await this.resolve(depName, versionRange, searchDir, rootPath);
      if (child !== 'cycle') {
        ret.push(child);
      }
    }
    return ret;
  }

  /**
   * Resolve a dependency and add it to the graph, returning its key
   */
  private async resolve(depName: string, versionRange: string, searchDir: string, rootPath: string[]): Promise<string | 'cycle'> {
    // Get rid of any monorepo symlinks
    searchDir = await fs.realpath(searchDir);

    const dupeIndex = rootPath.findIndex(([name, _]) => name === depName);
    if (dupeIndex > -1) {
      const beforeCycle = rootPath.slice(0, dupeIndex);
      const inCycle = [...rootPath.slice(dupeIndex), depName];
      const cycleString = inCycle.join(' => ');
      if (!this.reportedCycles.has(cycleString)) {
        // eslint-disable-next-line no-console
        console.warn(`Dependency cycle: ${beforeCycle.join(' => ')} => [ ${cycleString} ]. Dropping dependency '${inCycle.slice(-2).join(' => ')}'.`);
        this.reportedCycles.add(cycleString);
      }
      return 'cycle';
    }

    const depDir = await findPackageDir(depName, searchDir);
    const depPkgJsonFile = path.join(depDir, 'package.json');
    const depPkgJson = await loadPackageJson(depPkgJsonFile);
    const yarnKey = `${depName}@${versionRange}`;

    // Sanity check (does not apply if the version range starts with npm: because then we can alias packages)
    if (depPkgJson.name !== depName && !versionRange.startsWith('npm:')) {
      throw new Error(`Looking for '${depName}' from ${searchDir}, but found '${depPkgJson.name}' in ${depDir}`);
    }

    let pkg;
    const yarnResolved = this.yarnLock.object[yarnKey];
    if (yarnResolved) {
      // Resolved by Yarn
      pkg = noUndefined({
        version: yarnResolved.version,
        integrity: yarnResolved.integrity,
        resolved: yarnResolved.resolved,
        requires: notEmpty(depPkgJson.dependencies),
      });
    } else {
      // Comes from monorepo, just use whatever's in package.json
      pkg = noUndefined({
        version: depPkgJson.version,
        requires: notEmpty(depPkgJson.dependencies),
      });
    }

    const prevKey = this.graph.has(depName, pkg);
    if (prevKey) {
      return prevKey;
    }

    const key = this.graph.addNode(depName, pkg);

    for (const childKey of await this.resolveMap(depPkgJson.dependencies ?? {}, depDir, [depName, ...rootPath])) {
      this.graph.addEdge(key, childKey);
    }

    return key;
  }
}

// eslint-disable-next-line @stylistic/max-len
async function findYarnLock(start: string) {
  return findUp('yarn.lock', start);
}

async function findUp(fileName: string, start: string) {
  start = path.resolve(start);
  let dir = start;
  const yarnLockHere = () => path.join(dir, fileName);
  while (!await fileExists(yarnLockHere())) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`No ${fileName} found upwards from ${start}`);
    }
    dir = parent;
  }

  return yarnLockHere();
}

async function loadPackageJson(fileName: string): Promise<PackageJson> {
  return JSON.parse(await fs.readFile(fileName, { encoding: 'utf8' }));
}

async function fileExists(fullPath: string): Promise<boolean> {
  try {
    await fs.stat(fullPath);
    return true;
  } catch (e: any) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      return false;
    }
    throw e;
  }
}

export function formatPackageLock(entry: PackageLockTree) {
  const lines = new Array<string>();
  recurse([], entry);
  return lines.join('\n');

  function recurse(names: string[], thisEntry: PackageLockTree) {
    if (names.length > 0) {
      // eslint-disable-next-line no-console
      lines.push(`${names.join(' -> ')} @ ${thisEntry.version}`);
    }
    for (const [depName, depEntry] of iterDeps(thisEntry)) {
      recurse([...names, depName], depEntry);
    }
  }
}

/**
 * Find package directory
 *
 * Do this by walking upwards in the directory tree until we find
 * `<dir>/node_modules/<package>/package.json`.
 *
 * -------
 *
 * Things that we tried but don't work:
 *
 * 1.    require.resolve(`${depName}/package.json`, { paths: [rootDir] });
 *
 * Breaks with ES Modules if `package.json` has not been exported, which is
 * being enforced starting Node >= 12.
 *
 * 2.    findPackageJsonUpwardFrom(require.resolve(depName, { paths: [rootDir] }))
 *
 * Breaks if a built-in NodeJS package name conflicts with an NPM package name
 * (in Node15 `string_decoder` is introduced...)
 */
async function findPackageDir(depName: string, rootDir: string) {
  let prevDir;
  let dir = rootDir;
  while (dir !== prevDir) {
    const candidateDir = path.join(dir, 'node_modules', depName);
    if (await new Promise(ok => exists(path.join(candidateDir, 'package.json'), ok))) {
      return candidateDir;
    }

    prevDir = dir;
    dir = path.dirname(dir); // dirname('/') -> '/', dirname('c:\\') -> 'c:\\'
  }

  throw new Error(`Did not find '${depName}' upwards of '${rootDir}'`);
}

/**
 * We may sometimes try to adjust a package version to a version that's incompatible with the declared requirement.
 *
 * For example, this recently happened for 'netmask', where the package we
 * depend on has `{ requires: { netmask: '^1.0.6', } }`, but we need to force-substitute in version `2.0.1`.
 *
 * If NPM processes the shrinkwrap and encounters the following situation:
 *
 * ```
 * {
 *   netmask: { version: '2.0.1' },
 *   resolver: {
 *     requires: {
 *       netmask: '^1.0.6'
 *     }
 *   }
 * }
 * ```
 *
 * NPM is going to disregard the swhinkrwap and still give `resolver` its own private
 * copy of netmask `^1.0.6`.
 *
 * We tried overriding the `requires` version, and that works for `npm install` (yay)
 * but if anyone runs `npm ls` afterwards, `npm ls` is going to check the actual source
 * `package.jsons` against the actual `node_modules` file tree, and complain that the
 * versions don't match.
 *
 * We run `npm ls` in our tests to make sure our dependency tree is sane, and our customers
 * might too, so this is not a great solution.
 *
 * To cut any discussion short in the future, we're going to detect this situation and
 * tell our future selves that is cannot and will not work, and we should find another
 * solution.
 */
export function checkRequiredVersions(root: PackageLockFile) {
  recurse(root, [[root.name, root]]);

  // rootPath does include 'entry'
  function recurse(entry: PackageLockFile | PackageLockPackage, rootPath: RootPath) {
    // On the root, 'requires' is the value 'true', for God knows what reason. Don't care about those.
    if (typeof entry.requires === 'object') {
      // For every 'requires' dependency, find the version it actually got resolved to and compare.
      for (let [name, range] of Object.entries(entry.requires)) {
        const resolvedRet = findResolved(name, rootPath);
        if (!resolvedRet) {
          continue;
        }
        const [resolvedPackage, resolvedPath] = resolvedRet;

        if (range.includes('@')) {
          // For alias packages
          range = range.split('@')[1];
        }

        const depPath = [name, ...rootPath.map(x => x[0])];
        if (!semver.satisfies(resolvedPackage.version, range)) {
          // Ruh-roh.
          throw new Error(`Looks like we're trying to force '${renderRootPath(depPath)}' to version '${resolvedPackage.version}' (found at ${resolvedPath} => ${name}), but `
            + `${depPath[depPath.length - 1]} specifies the dependency as '${range}'. NPM will not respect this shrinkwrap file. Try vendoring a patched `
            + 'version of the intermediary dependencies instead');
        }
      }
    }

    for (const [name, dep] of iterDeps(entry)) {
      recurse(dep, [[name, dep], ...rootPath]);
    }
  }

  /**
   * Find a package name in a package lock tree.
   */
  function findResolved(name: string, chain: RootPath): [PackageLockPackage, string] | undefined {
    for (let i = 0; i < chain.length; i++) {
      const level = chain[i][1];
      if (level.dependencies?.[name] && level.dependencies?.[name] !== 'moved') {
        return [level.dependencies?.[name], renderRootPath(chain.slice(i))];
      }
    }
    return undefined;
  }
}

/**
 * Check that all packages still resolve their dependencies to the right versions
 *
 * We have manipulated the tree a bunch. Do a sanity check to ensure that all declared
 * dependencies are satisfied.
 */
export function _validateTree(lock: PackageLockTree) {
  const errors = new Array<string>();
  recurse(lock, [['root', lock]], {});
  if (errors.length > 0) {
    throw new Error(`Could not satisfy one or more dependencies:\n${errors.join('\n')}`);
  }

  // rootPath does include pkg
  function recurse(pkg: PackageLockTree, rootPath: RootPath, inheritedDepsVersions: Record<string, string>) {
    const depsVersionsHere = {
      ...inheritedDepsVersions,
      ...Object.fromEntries(iterDeps(pkg).map(([name, pack]) => [name, pack.version])),
    };

    for (const [name, expectedVersion] of Object.entries(pkg.requires ?? {})) {
      checkRequiresOf(name, expectedVersion, depsVersionsHere, rootPath);
    }

    for (const [name, pack] of iterDeps(pkg)) {
      const p: RootPath = [[name, pack], ...rootPath];
      recurse(pack, p, depsVersionsHere);
    }
  }

  // rootPath: most specific one first, should NOT include name
  function checkRequiresOf(name: string, declaredRange: string, depsVersions: Record<string, string>, rootPath: RootPath) {
    if (declaredRange.includes('@')) {
      // For alias packages
      declaredRange = declaredRange.split('@')[1];
    }

    const foundVersion = depsVersions[name];
    const newRootPath = [name, ...rootPath.map(x => x[0])];
    if (!foundVersion) {
      errors.push(`Dependency on ${renderRootPath(newRootPath)} not satisfied: not found`);
    } else if (!semver.satisfies(foundVersion, declaredRange)) {
      // eslint-disable-next-line no-console
      errors.push(`Dependency on ${renderRootPath(newRootPath)} not satisfied: declared range '${declaredRange}', found '${foundVersion}'`);
    }
  }
}

function notEmpty<A extends object>(x: A | undefined): A | undefined {
  return x && Object.keys(x).length > 0 ? x : undefined;
}

function noUndefined<A extends object>(xs: A): NonNullableKeys<A> {
  return Object.fromEntries(Object.entries(xs).filter(([_, v]) => v !== undefined)) as any;
}

type NonNullableKeys<T> = {
  [P in keyof T as undefined extends T[P] ? P : never]?: NonNullable<T[P]>
} & {
  [P in keyof T as undefined extends T[P] ? never : P]: T[P]
};

// RootPath is always reversed (i.e. closest first)
type RootPath = Array<[string, PackageLockTree]>;

function renderRootPath(p: RootPath | string[]) {
  return p.map(x => Array.isArray(x)? x[0] : x).reverse().join(' => ');
}

class PackageGraph {
  private readonly nodes = new Map<string, [string, Omit<PackageLockPackage, 'dependencies'>]>();
  private readonly _edges = new Map<string, string[]>();

  public key(name: string, pkg: PackageLockPackage) {
    return `${name}@${pkg.version}`;
  }

  public has(name: string, pkg: PackageLockPackage): string | undefined {
    const key = this.key(name, pkg);
    return this.nodes.has(key) ? key : undefined;
  }

  public addNode(name: string, pkg: PackageLockPackage) {
    const key = this.key(name, pkg);
    if (this.nodes.has(key)) {
      throw new Error(`Package already in graph: ${key}`);
    }

    const copy = { ...pkg };
    delete copy.dependencies;
    this.nodes.set(key, [name, copy]);
    return key;
  }

  public addEdge(parent: string, child: string) {
    let edges = this._edges.get(parent);
    if (!edges) {
      edges = [];
      this._edges.set(parent, edges);
    }
    edges.push(child);
  }

  public node(key: string) {
    const x = this.nodes.get(key);
    if (!x) {
      throw new Error(`No such package: ${key}`);
    }
    return x;
  }

  public edges(parent: string) {
    return Array.from(new Set(this._edges.get(parent) ?? []));
  }

  public toGraphviz() {
    const lines = ['digraph {'];

    // Add all nodes
    for (const [key, [name, pkg]] of this.nodes.entries()) {
      lines.push(`  "${key}" [label="${name}@${pkg.version}"];`);
    }

    // Add all edges
    for (const [parent, children] of this._edges.entries()) {
      for (const child of children) {
        lines.push(`  "${parent}" -> "${child}";`);
      }
    }

    lines.push('}');
    return lines.join('\n');
  }
}
