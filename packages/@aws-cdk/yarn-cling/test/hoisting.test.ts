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

test('reproduce hoisting bug', () => {
  // GIVEN
  let tree = pkgFile({
    // Prevent pushing child1 and child2 upwards
    child2: pkg('999.999.999'),
    child1: pkg('999.999.999'),

    // sharedparent doesn't have anything to do with 'conflictdep' itself,
    // but has 2 children that depend on conflicting versions.
    //
    // conflictdep@1 is at the top of the tree already.
    // We want to avoid that conflictdep@2 gets pushed up because the
    // slot in sharedparent.dependencies['conflictdep'] is "free" (because it
    // isn't).
    sharedparent: pkg('2.0.0', {
      child2: pkg('4.0.0', {
        conflictdep: pkg('2.0.0'),
      }),
      child1: pkg2('3.0.0', {
        requires: { conflictdep: '1.0.0' },
      }),
    }),
    conflictdep: pkg('1.0.0'),
  });

  // WHEN
  tree = hoistDependencies(tree);

  // THEN -- should not throw
  _validateTree(tree);
});

test('_validateTree respects resolutions', () => {
  // GIVEN - a tree where string-width v4 is installed but v5 is required
  const tree = pkgFile({
    parent: pkg2('1.0.0', {
      requires: { 'string-width': '^5.1.2' },
      dependencies: {
        'string-width': pkg('4.2.3'),
      },
    }),
  });

  const resolutions = {
    'string-width': '^4.2.3',
  };

  // THEN - should not throw because resolutions override the required version
  expect(() => _validateTree(tree, resolutions)).not.toThrow();
});

test('_validateTree fails without resolutions when version mismatch', () => {
  // GIVEN - same tree but without resolutions
  const tree = pkgFile({
    parent: pkg2('1.0.0', {
      requires: { 'string-width': '^5.1.2' },
      dependencies: {
        'string-width': pkg('4.2.3'),
      },
    }),
  });

  // THEN - should throw because version doesn't satisfy requirement
  expect(() => _validateTree(tree)).toThrow(/Could not satisfy one or more dependencies/);
});

test('_validateTree resolutions only apply to specified packages', () => {
  // GIVEN - tree with two mismatched versions
  const tree = pkgFile({
    parent: pkg2('1.0.0', {
      requires: {
        'string-width': '^5.1.2',
        'strip-ansi': '^7.0.0',
      },
      dependencies: {
        'string-width': pkg('4.2.3'),
        'strip-ansi': pkg('6.0.1'),
      },
    }),
  });

  const resolutions = {
    'string-width': '^4.2.3',
    // strip-ansi is NOT in resolutions
  };

  // THEN - should throw for strip-ansi but not for string-width
  expect(() => _validateTree(tree, resolutions)).toThrow(/strip-ansi/);
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

interface Pkg2Options {
  dependencies?: Record<string, PackageLockPackage>;
  requires?: Record<string, string>;
}

function pkg2(version: string, options: Pkg2Options): PackageLockPackage {
  return {
    version,
    dependencies: options.dependencies,
    requires: options.requires,
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
