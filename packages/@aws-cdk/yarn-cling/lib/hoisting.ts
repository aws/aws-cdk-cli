import { _validateTree } from '.';
import { iterDeps, isPackage, type PackageLockFile, type PackageLockTree } from './types';

/**
 * Hoist package-lock dependencies in-place
 *
 * Packages are declared in two different roles here:
 *
 * - "requires" indicates where a package is consumed
 * - "dependencies" indicates where a package is provided; it will be available
 *   to the package it is provided under, as well as any of its children.
 *
 * This function manipulates the "dependencies" part of the package tree, minimizing
 * the occurrences of packages in "dependencies" while keeping all "requires" satified.
 *
 * This happens by applying two basic operations:
 *
 * 1) Move every package into the parent scope (as long as it introduces no conflicts).
 *    Leave "moved" markers to indicate that a package used to be there and no
 *    new package with the same name should be moved up into that location.
 * 2) Once no more packages can be moved up, clean up the tree. This step mutates the
 *    tree declarations but cannot change versions of required packages. Two cleanups:
 *    2a) Remove duplicates down the tree (same version that is inherited from above)
 *    2b) Remove useless packages that aren't depended upon by anything in that subtree.
 *
 * This two-phase process replaces a proces that did move-and-delete as one step, which
 * sometimes would hoist a package into a place that was previously vacated by a conflicting
 * version, thereby causing the wrong version to be loaded.
 *
 * Hoisting is still rather expensive on a large tree (~100ms), we should find ways to
 * speed it up.
 */
export function hoistDependencies(packageTree: PackageLockFile): PackageLockFile {
  let tree = packageTree;
  tree = _addTombstones(tree);
  tree = _pushDepsToParent(tree);
  tree = _removeDupesWithParent(tree);
  tree = _removeTombstones(tree);
  tree = _removeUseless(tree, packageTree);
  return tree;
}

export function renderTree(tree: PackageLockTree): string[] {
  const ret = new Array<string>();
  recurse(tree, []);
  return ret.sort(compareSplit);

  function recurse(x: PackageLockTree, parts: string[]) {
    for (const [k, v] of Object.entries(x.dependencies ?? {})) {
      ret.push([...parts, k].join('.') + '=' + (isPackage(v) ? v.version : '...'));
      if (isPackage(v)) {
        recurse(v, [...parts, k]);
      }
    }
  }

  function compareSplit(a: string, b: string): number {
    // Sort so that: 'a=1', 'a.b=2' get sorted in that order.
    const as = a.split(/\.|=/g);
    const bs = b.split(/\.|=/g);

    for (let i = 0; i < as.length && i < bs.length; i++) {
      const cmp = as[i].localeCompare(bs[i]);
      if (cmp !== 0) {
        return cmp;
      }
    }

    return as.length - bs.length;
  }
}

export function _addTombstones<A extends PackageLockTree>(root: A): A {
  let tree = structuredClone(root);
  recurse(tree, [tree]);
  return tree;

  function recurse(nodeToCheck: PackageLockTree, rootPathToAdd: PackageLockTree[]) {
    // Rootpath is ordered deep -> shallow.

    // For every node, all the packages they or any of their children 'requires' should be in 'dependencies'.
    // If it's not in 'dependencies', that must mean its at a higher level already, so we put
    // the 'moved' tombstone in to make sure we don't accidentally replace this package with a different version.
    // Also add 'moved' to all of its parents, until we find a node that has it in 'dependencies'.
    for (const name of Object.keys(nodeToCheck.requires ?? {})) {
      // For every dependency in 'nodeToCheck', add 'moved' to 'depend. As soon as we find
      // the dependency provided declared anywhere, we stop.
      for (const nodeToAdd of rootPathToAdd) {
        if (nodeToAdd.dependencies?.[name]) {
          break;
        }
        nodeToAdd.dependencies = nodeToAdd.dependencies ?? {};
        nodeToAdd.dependencies[name] = 'moved';
      }
    }

    for (const [_, dep] of iterDeps(nodeToCheck)) {
      recurse(dep, [dep, ...rootPathToAdd]);
    }
  }
}

export function _pushDepsToParent<A extends PackageLockTree>(root: A): A {
  let tree = structuredClone(root);
  while (recurse(tree)) {
  }
  return tree;

  function recurse(node: PackageLockTree, parent?: PackageLockTree): boolean {
    if (parent) {
      for (const [name, dep] of iterDeps(node)) {
        if (!parent.dependencies![name]) {
          parent.dependencies![name] = dep;
          node.dependencies![name] = 'moved';
          return true;
        }
      }
    }

    for (const [_, dep] of iterDeps(node)) {
      if (recurse(dep, node)) {
        return true;
      }
    }

    return false;
  }
}

// Move dependencies up a level if there is no conflict
export function _pushDepsToParent0<A extends PackageLockTree>(root: A): A {
  root = structuredClone(root);

  postOrderRecurse(root, (node, parent) => {
    if (!parent) {
      return;
    }

    for (const [depName, depPackage] of iterDeps(node)) {
      // Move the package up
      if (!parent?.dependencies?.[depName]) {
        parent.dependencies![depName] = structuredClone(depPackage);
        node.dependencies![depName] = 'moved';
      }
    }
  });

  return root;
}

export function _removeDupesWithParent<A extends PackageLockTree>(root: A): A {
  root = structuredClone(root);
  postOrderRecurse(root, (node, parent) => {
    if (!node.dependencies || !parent) {
      return;
    }

    for (const [depName, depPackage] of iterDeps(node)) {
      // Any dependencies here that are the same in the parent can be removed
      const parentDep = parent.dependencies![depName];
      if (isPackage(parentDep) && parentDep.version === depPackage.version) {
        delete node.dependencies[depName];
      }
    }
  });
  return root;
}

function _removeUseless<A extends PackageLockTree>(root: A, originalTree: A): A {
  if (originalTree.requires === true) {
    const topLevelDependencies = Object.keys(originalTree.dependencies ?? {});
    // Temporarily replace 'requires' with the set of original dependencies so
    // that the '_removeUseless' op will not shake them.
    root.requires = Object.fromEntries(topLevelDependencies.map((dep) => [dep, '*']));
  }

  root = structuredClone(root);
  recurse(root);

  if (originalTree.requires === true) {
    // Put the 'true' back
    root.requires = true;
  }

  return root;

  function recurse(node: PackageLockTree): Set<string> {
    const requiredHere = new Set<string>(Object.keys(node.requires ?? {}));

    // Build a { dependency -> required* } map for every dependency
    const requiredByDeps = new Map<string, Set<string>>(iterDeps(node).map(([name, pack]) => [name, recurse(pack)]));

    // Peel deps off the `requiredByDeps` map until we can't anymore
    let allRequires = setUnion(requiredHere, ...requiredByDeps.values());
    let changed;
    do {
      changed = false;

      for (const depName of requiredByDeps.keys()) {
        if (!allRequires.has(depName)) {
          requiredByDeps.delete(depName);
          delete node.dependencies![depName];
          changed = true;
          allRequires = setUnion(requiredHere, ...requiredByDeps.values());
        }
      }
    } while (changed);

    if (Object.keys(node.dependencies ?? {}).length === 0) {
      delete node.dependencies;
    }

    return allRequires;
  }
}

/**
 * Remove the 'moved' markers
 */
function _removeTombstones<A extends PackageLockTree>(root: A): A {
  postOrderRecurse(root, (node) => {
    for (const [name, v] of Object.entries(node.dependencies ?? {})) {
      if (v === 'moved') {
        delete node.dependencies![name];
      }
    }
  });
  return root;
}

function postOrderRecurse(root: PackageLockTree, block: (node: PackageLockTree, parent?: PackageLockTree) => void) {
  recurse(root);

  function recurse(node: PackageLockTree, parent?: PackageLockTree) {
    for (const [_, child] of iterDeps(node)) {
      recurse(child, node);
    }

    block(node, parent);
  }
}

function setUnion<A>(...xss: Array<Set<A>>): Set<A> {
  const ret = new Set<A>();
  for (const xs of xss) {
    for (const x of xs) {
      ret.add(x);
    }
  }
  return ret;
}
