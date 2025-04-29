import { hoistDependencies, renderTree } from '../lib/hoisting';
import { _validateTree } from '../lib/index';
import type { PackageLockFile, PackageLockPackage } from '../lib/types';

test('nonconflicting tree gets flattened', () => {
  // GIVEN
  let tree = pkgFile({
    stringutil: pkg('1.0.0', {
      leftpad: pkg('2.0.0'),
    }),
    numutil: pkg('3.0.0', {
      isodd: pkg('4.0.0'),
    }),
  });

  // WHEN
  tree = hoistDependencies(tree);

  // THEN
  expect(renderTree(tree)).toEqual([
    'isodd=4.0.0',
    'leftpad=2.0.0',
    'numutil=3.0.0',
    'stringutil=1.0.0',
  ]);
});

test('matching versions get deduped', () => {
  // GIVEN
  let tree = pkgFile({
    stringutil: pkg('1.0.0', {
      leftpad: pkg('2.0.0'),
    }),
    numutil: pkg('3.0.0', {
      leftpad: pkg('2.0.0'),
      isodd: pkg('4.0.0'),
    }),
  });

  // WHEN
  tree = hoistDependencies(tree);

  // THEN
  expect(renderTree(tree)).toEqual([
    'isodd=4.0.0',
    'leftpad=2.0.0',
    'numutil=3.0.0',
    'stringutil=1.0.0',
  ]);
});

test('conflicting versions get left in place', () => {
  // GIVEN
  let tree = pkgFile({
    stringutil: pkg('1.0.0', {
      leftpad: pkg('2.0.0'),
    }),
    numutil: pkg('3.0.0', {
      leftpad: pkg('5.0.0'),
      isodd: pkg('4.0.0'),
    }),
  });

  // WHEN
  tree = hoistDependencies(tree);

  // THEN
  expect(renderTree(tree)).toEqual([
    'isodd=4.0.0',
    'leftpad=2.0.0',
    'numutil=3.0.0',
    'numutil.leftpad=5.0.0',
    'stringutil=1.0.0',
  ]);
});

test('dependencies of deduped packages are not hoisted into useless positions', () => {
  // GIVEN
  let tree = pkgFile({
    stringutil: pkg('1.0.0', {
      leftpad: pkg('2.0.0', {
        spacemaker: pkg('3.0.0'),
      }),
    }),
    leftpad: pkg('2.0.0', {
      spacemaker: pkg('3.0.0'),
    }),
    spacemaker: pkg('4.0.0'),
  });

  // WHEN
  tree = hoistDependencies(tree);

  // THEN
  expect(renderTree(tree)).toEqual([
    'leftpad=2.0.0',
    'leftpad.spacemaker=3.0.0',
    'spacemaker=4.0.0',
    'stringutil=1.0.0',
  ]);
});

test('dont hoist into a parent if it would cause an incorrect version there', () => {
  // GIVEN
  let tree = pkgFile({
    stringutil: pkg('1.0.0', {
      spacemaker: pkg('10.0.0'),
      leftPad: pkg('2.0.0', {
        spacemaker: pkg('3.0.0'),
      }),
    }),
    leftPad: pkg('1.0.0'), // Prevents previous leftPad from being hoisted
  });

  // WHEN
  tree = hoistDependencies(tree);

  // THEN
  expect(renderTree(tree)).toEqual([
    'leftPad=1.0.0',
    'spacemaker=10.0.0',
    'stringutil=1.0.0',
    'stringutil.leftPad=2.0.0',
    'stringutil.leftPad.spacemaker=3.0.0',
  ]);
});

test('order of hoisting shouldnt produce a broken situation', () => {
  // GIVEN
  let tree = pkgFile({
    stringutil: pkg('1.0.0', {
      wrapper: pkg('100.0.0', {
        leftPad: pkg('2.0.0', {
          spacemaker: pkg('3.0.0'),
        }),
      }),
      spacemaker: pkg('4.0.0'), // Prevents spacemaker from being hoisted here, but then leftPad also shouldn't be
    }),
  });

  // WHEN
  tree = hoistDependencies(tree);

  // THEN
  /* // Both answers are fine but the current algorithm picks the 2nd
  expect(renderTree(tree)).toEqual([
    'leftPad=2.0.0',
    'spacemaker=3.0.0',
    'stringutil=1.0.0',
    'stringutil.spacemaker=4.0.0',
    'wrapper=100.0.0',
  ]);
  */
  expect(renderTree(tree)).toEqual([
    'leftPad=2.0.0',
    'leftPad.spacemaker=3.0.0',
    'spacemaker=4.0.0',
    'stringutil=1.0.0',
    'wrapper=100.0.0',
  ]);
});

function pkg(version: string, dependencies?: Record<string, PackageLockPackage>): PackageLockPackage {
  return {
    version,
    ...dependencies ? {
      dependencies,
      requires: Object.fromEntries(Object.entries(dependencies).map(([name, p]) => [name, p.version])),
    } : undefined,
  };
}

function pkgFile(dependencies?: Record<string, PackageLockPackage>): PackageLockFile {
  return {
    lockfileVersion: 1,
    name: 'test',
    version: '0.0.0',
    requires: true,
    dependencies,
  };
}
