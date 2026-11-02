import type { Stats } from 'fs';
import { createIgnoreMatcher } from '../../lib/util/glob-matcher';

// Chokidar v4 invokes the `ignored` callback with the file system `Stats` of
// the entry being considered. These helpers let tests state, explicitly, that a
// given path is a file or a directory - which is what drives the matcher's
// file-vs-directory branching.
const FILE = { isFile: () => true, isDirectory: () => false } as unknown as Stats;
const DIR = { isFile: () => false, isDirectory: () => true } as unknown as Stats;

describe('glob-matcher', () => {
  describe('createIgnoreMatcher', () => {
    describe('default behavior', () => {
      test('matches all files when no patterns specified', () => {
        const shouldIgnore = createIgnoreMatcher({});

        // Should NOT ignore any files (default include is **)
        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('deep/nested/path/file.ts', FILE)).toBe(false);
      });

      test('matches all files when include is empty array', () => {
        const shouldIgnore = createIgnoreMatcher({ include: [] });

        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
      });
    });

    describe('include patterns', () => {
      test('matches files with ** pattern', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**'] });

        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('a/b/c/d/file.ts', FILE)).toBe(false);
      });

      test('matches TypeScript files with **/*.ts pattern', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**/*.ts'] });

        // Should NOT ignore .ts files
        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('deep/nested/file.ts', FILE)).toBe(false);

        // Should ignore non-.ts files
        expect(shouldIgnore('file.js', FILE)).toBe(true);
        expect(shouldIgnore('file.json', FILE)).toBe(true);
        expect(shouldIgnore('README.md', FILE)).toBe(true);
      });

      test('matches files in specific directory with src/** pattern', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['src/**'] });

        // Should NOT ignore files in src/
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/nested/file.ts', FILE)).toBe(false);

        // Should ignore files outside src/
        expect(shouldIgnore('file.ts', FILE)).toBe(true);
        expect(shouldIgnore('test/file.ts', FILE)).toBe(true);
        expect(shouldIgnore('lib/file.ts', FILE)).toBe(true);
      });

      test('supports multiple include patterns', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['**/*.ts', '**/*.js'],
        });

        // Should NOT ignore .ts and .js files
        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('file.js', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.js', FILE)).toBe(false);

        // Should ignore other files
        expect(shouldIgnore('file.json', FILE)).toBe(true);
        expect(shouldIgnore('file.md', FILE)).toBe(true);
      });
    });

    describe('directory traversal', () => {
      // Regression test for https://github.com/aws/aws-cdk-cli/issues/1647:
      // a user-supplied file glob like 'src/**/*.ts' must not cause chokidar to
      // prune the 'src' directory (which doesn't itself match the glob), or the
      // nested .ts files are never discovered and watch silently does nothing.
      test('does not prune ancestor directories of a file glob', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['src/**/*.ts'] });

        // Directories that could contain matching files must be traversed.
        expect(shouldIgnore('src', DIR)).toBe(false);
        expect(shouldIgnore('src/sub', DIR)).toBe(false);
        expect(shouldIgnore('src/sub/deep', DIR)).toBe(false);

        // The matching files themselves are watched.
        expect(shouldIgnore('src/a.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/sub/b.ts', FILE)).toBe(false);

        // Non-matching files under those directories are still ignored.
        expect(shouldIgnore('src/a.js', FILE)).toBe(true);
        expect(shouldIgnore('src/sub/b.css', FILE)).toBe(true);
      });

      test('prunes directories that cannot contain matching files', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['src/**/*.ts'] });

        // 'lib' can never hold a file matching 'src/**/*.ts', so it is pruned.
        expect(shouldIgnore('lib', DIR)).toBe(true);
        expect(shouldIgnore('test', DIR)).toBe(true);
      });

      test('directories are only pruned by excludes, never by the include filter', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['**/*.ts'],
          exclude: ['**/node_modules/**'],
        });

        // A directory never matches a file glob like '**/*.ts', but it must
        // still be traversed - only excludes prune directories.
        expect(shouldIgnore('src', DIR)).toBe(false);
        expect(shouldIgnore('any/deep/dir', DIR)).toBe(false);

        // Excluded directories are pruned.
        expect(shouldIgnore('node_modules', DIR)).toBe(true);
        expect(shouldIgnore('src/node_modules', DIR)).toBe(true);
      });

      test('handles multiple file globs across separate directory trees', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['src/**/*.ts', 'cdk/**/*.ts'],
        });

        // Both roots and their subtrees are traversed.
        expect(shouldIgnore('src', DIR)).toBe(false);
        expect(shouldIgnore('cdk', DIR)).toBe(false);
        expect(shouldIgnore('src/sub', DIR)).toBe(false);

        // A directory matched by neither glob is pruned.
        expect(shouldIgnore('lib', DIR)).toBe(true);

        // Files match according to their tree.
        expect(shouldIgnore('src/a.ts', FILE)).toBe(false);
        expect(shouldIgnore('cdk/b.ts', FILE)).toBe(false);
        expect(shouldIgnore('lib/c.ts', FILE)).toBe(true);
      });

      test('no-stats invocations keep potential ancestors and matching files', () => {
        // Chokidar consults the callback both with and without stats during
        // traversal (e.g. the cheap pre-check in `_addToNodeFs` before it stats
        // a path, and again with the real stats afterwards). Without stats we
        // cannot prune a path that might be a directory ancestor of a match, so
        // it must be kept.
        const shouldIgnore = createIgnoreMatcher({ include: ['src/**/*.ts'] });

        expect(shouldIgnore('src')).toBe(false);
        expect(shouldIgnore('src/sub')).toBe(false);
        expect(shouldIgnore('src/a.ts')).toBe(false);

        // A path that can be neither an ancestor nor a matching file is ignored.
        expect(shouldIgnore('lib')).toBe(true);
        expect(shouldIgnore('lib/a.ts')).toBe(true);
      });

      test('no-stats invocations are permissive for **-leading globs, deferring to the stats call', () => {
        // A '**'-leading include (e.g. '**/my-dir/*') could match a file in any
        // directory, so every directory is a potential ancestor. The no-stats
        // pre-check therefore cannot prune anything - the real filtering happens
        // on the subsequent invocation that carries stats. This is the exact
        // shape that surfaced as test churn: the no-stats call keeps a path the
        // with-stats FILE call then rejects.
        const shouldIgnore = createIgnoreMatcher({ include: ['**/my-dir/*'] });

        // No-stats: nothing can be pruned, because any directory might lead to
        // a 'my-dir' somewhere below it.
        expect(shouldIgnore('other-dir/file.ts')).toBe(false);
        expect(shouldIgnore('other-dir')).toBe(false);

        // With stats: the file is correctly rejected (it isn't under a my-dir),
        // while the matching file is kept and its ancestor directory traversed.
        expect(shouldIgnore('other-dir/file.ts', FILE)).toBe(true);
        expect(shouldIgnore('nested/my-dir/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('nested', DIR)).toBe(false);
      });

      test('an excluded path is ignored even without stats', () => {
        // Excludes apply uniformly regardless of whether stats are present, so
        // the no-stats pre-check still prunes excluded subtrees up front.
        const shouldIgnore = createIgnoreMatcher({
          include: ['**/*.ts'],
          exclude: ['**/node_modules/**'],
        });

        expect(shouldIgnore('node_modules/pkg/index.ts')).toBe(true);
        expect(shouldIgnore('src/node_modules')).toBe(true);
      });
    });

    describe('exclude patterns', () => {
      test('excludes files matching exclude pattern', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['**/node_modules/**'],
        });

        // Should ignore node_modules
        expect(shouldIgnore('node_modules/package/index.js', FILE)).toBe(true);
        expect(shouldIgnore('src/node_modules/package/index.js', FILE)).toBe(true);

        // Should NOT ignore other files
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('file.ts', FILE)).toBe(false);
      });

      test('excludes dotfiles with .* pattern', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['.*'],
        });

        // Should ignore dotfiles at root
        expect(shouldIgnore('.gitignore', FILE)).toBe(true);
        expect(shouldIgnore('.eslintrc', FILE)).toBe(true);

        // Should NOT ignore regular files
        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
      });

      test('excludes nested dotfiles with **/.*/** pattern', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['**/.*/**'],
        });

        // Should ignore files inside dot directories
        expect(shouldIgnore('.git/config', FILE)).toBe(true);
        expect(shouldIgnore('src/.hidden/file.ts', FILE)).toBe(true);

        // Should NOT ignore regular files
        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
      });

      test('supports multiple exclude patterns', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts'],
        });

        // Should ignore all excluded patterns
        expect(shouldIgnore('node_modules/pkg/index.js', FILE)).toBe(true);
        expect(shouldIgnore('dist/bundle.js', FILE)).toBe(true);
        expect(shouldIgnore('src/file.test.ts', FILE)).toBe(true);

        // Should NOT ignore other files
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('lib/index.ts', FILE)).toBe(false);
      });
    });

    describe('combined include and exclude', () => {
      test('exclude takes precedence over include', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['**/*.ts'],
          exclude: ['**/*.test.ts'],
        });

        // Should NOT ignore regular .ts files
        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);

        // Should ignore .test.ts files (exclude wins)
        expect(shouldIgnore('file.test.ts', FILE)).toBe(true);
        expect(shouldIgnore('src/file.test.ts', FILE)).toBe(true);

        // Should ignore non-.ts files (not in include)
        expect(shouldIgnore('file.js', FILE)).toBe(true);
      });

      test('realistic watch configuration', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['**'],
          exclude: [
            '**/node_modules/**',
            '**/cdk.out/**',
            '.*',
            '**/.*',
            '**/.*/**',
          ],
        });

        // Should NOT ignore source files
        expect(shouldIgnore('src/index.ts', FILE)).toBe(false);
        expect(shouldIgnore('lib/stack.ts', FILE)).toBe(false);
        expect(shouldIgnore('bin/app.ts', FILE)).toBe(false);

        // Should ignore node_modules
        expect(shouldIgnore('node_modules/aws-cdk/index.js', FILE)).toBe(true);

        // Should ignore cdk.out
        expect(shouldIgnore('cdk.out/manifest.json', FILE)).toBe(true);

        // Should ignore dotfiles
        expect(shouldIgnore('.gitignore', FILE)).toBe(true);
        expect(shouldIgnore('.git/config', FILE)).toBe(true);
      });
    });

    describe('path normalization', () => {
      test('normalizes Windows-style paths', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['src/**/*.ts'],
        });

        // Should handle backslashes (Windows paths)
        expect(shouldIgnore('src\\file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src\\nested\\file.ts', FILE)).toBe(false);
      });
    });

    describe('edge cases', () => {
      test('handles empty string path', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**'] });
        // Empty path doesn't match ** pattern
        expect(shouldIgnore('', FILE)).toBe(true);
      });

      test('handles paths with special characters', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**'] });

        expect(shouldIgnore('file with spaces.ts', FILE)).toBe(false);
        expect(shouldIgnore('file-with-dashes.ts', FILE)).toBe(false);
        expect(shouldIgnore('file_with_underscores.ts', FILE)).toBe(false);
      });

      test('handles deeply nested paths', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**/*.ts'] });

        expect(shouldIgnore('a/b/c/d/e/f/g/h/i/j/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('a/b/c/d/e/f/g/h/i/j/file.js', FILE)).toBe(true);
      });

      test('handles root-level files', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['**/*.ts'],
          exclude: ['**/test/**'],
        });

        expect(shouldIgnore('index.ts', FILE)).toBe(false);
        expect(shouldIgnore('app.ts', FILE)).toBe(false);
      });
    });

    describe('pattern normalization (directory patterns)', () => {
      test('directory name without glob is treated as directory/** for include', () => {
        // When a pattern like 'my-dir' is provided (no glob characters),
        // it should match all files within that directory (like 'my-dir/**')
        const shouldIgnore = createIgnoreMatcher({
          include: ['my-dir'],
        });

        // Should NOT ignore files inside my-dir
        expect(shouldIgnore('my-dir/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('my-dir/nested/file.ts', FILE)).toBe(false);

        // Should ignore files outside my-dir
        expect(shouldIgnore('other-dir/file.ts', FILE)).toBe(true);
        expect(shouldIgnore('file.ts', FILE)).toBe(true);
      });

      test('directory name without glob is treated as directory/** for exclude', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['my-dir'],
        });

        // Should ignore files inside my-dir
        expect(shouldIgnore('my-dir/file.ts', FILE)).toBe(true);
        expect(shouldIgnore('my-dir/nested/file.ts', FILE)).toBe(true);

        // Should NOT ignore files outside my-dir
        expect(shouldIgnore('other-dir/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('file.ts', FILE)).toBe(false);
      });

      test('directory with trailing slash is normalized', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['my-dir/'],
        });

        // Should NOT ignore files inside my-dir
        expect(shouldIgnore('my-dir/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('my-dir/nested/file.ts', FILE)).toBe(false);

        // Should ignore files outside my-dir
        expect(shouldIgnore('other-dir/file.ts', FILE)).toBe(true);
      });

      test('patterns with glob characters are not normalized', () => {
        // Patterns with *, ?, or [ should be used as-is
        const shouldIgnore = createIgnoreMatcher({
          include: ['src/*.ts'], // Only matches .ts files directly in src/
        });

        // Should NOT ignore .ts files directly in src/
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);

        // Should ignore nested .ts files (pattern doesn't have **)
        expect(shouldIgnore('src/nested/file.ts', FILE)).toBe(true);

        // Should ignore non-.ts files
        expect(shouldIgnore('src/file.js', FILE)).toBe(true);
      });

      test('dot pattern is treated as directory', () => {
        // The '.' pattern should match all files (becomes './**')
        const shouldIgnore = createIgnoreMatcher({
          include: ['.'],
        });

        expect(shouldIgnore('file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('deep/nested/file.ts', FILE)).toBe(false);
      });

      test('multiple directory patterns work together', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['src', 'lib'],
        });

        // Should NOT ignore files in src/ or lib/
        expect(shouldIgnore('src/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('lib/file.ts', FILE)).toBe(false);
        expect(shouldIgnore('src/nested/file.ts', FILE)).toBe(false);

        // Should ignore files outside src/ and lib/
        expect(shouldIgnore('test/file.ts', FILE)).toBe(true);
        expect(shouldIgnore('file.ts', FILE)).toBe(true);
      });
    });
  });
});

describe('rootDir option (absolute path handling)', () => {
  const rootDir = '/Users/test/my-project';

  test('converts absolute paths to relative paths when rootDir is provided', () => {
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md', 'cdk*.json'],
      rootDir,
    });

    // Absolute paths should be converted to relative and matched
    expect(shouldIgnore(`${rootDir}/README.md`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.json`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.context.json`, FILE)).toBe(true);

    // Non-excluded files should NOT be ignored
    expect(shouldIgnore(`${rootDir}/src/index.ts`, FILE)).toBe(false);
    expect(shouldIgnore(`${rootDir}/lib/stack.ts`, FILE)).toBe(false);
  });

  test('handles the root directory itself', () => {
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md'],
      rootDir,
    });

    // The root directory itself should NOT be ignored
    expect(shouldIgnore(rootDir, DIR)).toBe(false);
  });

  test('still works with relative paths when rootDir is provided', () => {
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md', 'cdk*.json'],
      rootDir,
    });

    // Relative paths should still work
    expect(shouldIgnore('README.md', FILE)).toBe(true);
    expect(shouldIgnore('cdk.json', FILE)).toBe(true);
    expect(shouldIgnore('src/index.ts', FILE)).toBe(false);
  });

  test('handles paths outside rootDir', () => {
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md'],
      rootDir,
    });

    // Paths outside rootDir are not converted to relative paths
    // They remain as absolute paths. The ** pattern still matches them,
    // but the exclude pattern 'README.md' won't match '/other/path/README.md'
    // because it's not relative
    expect(shouldIgnore('/other/path/README.md', FILE)).toBe(false); // Matches ** but not excluded
    expect(shouldIgnore('/other/path/file.ts', FILE)).toBe(false); // Matches **
  });

  test('handles Windows-style rootDir', () => {
    const windowsRootDir = 'C:\\Users\\test\\my-project';
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md'],
      rootDir: windowsRootDir,
    });

    // Windows paths should be normalized and converted to relative
    expect(shouldIgnore('C:/Users/test/my-project/README.md', FILE)).toBe(true);
    expect(shouldIgnore('C:/Users/test/my-project/src/index.ts', FILE)).toBe(false);
  });

  test('handles rootDir with trailing slash', () => {
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md'],
      rootDir: '/Users/test/my-project/',
    });

    expect(shouldIgnore('/Users/test/my-project/README.md', FILE)).toBe(true);
    expect(shouldIgnore('/Users/test/my-project/src/index.ts', FILE)).toBe(false);
  });

  test('realistic chokidar v4 scenario', () => {
    // This simulates what chokidar v4 actually does - passing absolute paths
    // to the ignored callback even when cwd is set
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: [
        'README.md',
        'cdk*.json',
        '**/*.d.ts',
        '**/*.js',
        'tsconfig.json',
        'package*.json',
        'yarn.lock',
        'node_modules',
        'test',
        'cdk.out/**',
        '**/.*',
        '**/.*/**',
        '**/node_modules/**',
      ],
      rootDir,
    });

    // Files that should be ignored (absolute paths as chokidar passes them)
    expect(shouldIgnore(`${rootDir}/README.md`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.json`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.context.json`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/package.json`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/yarn.lock`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/tsconfig.json`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/node_modules/pkg/index.js`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/.gitignore`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/.git/config`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.out/manifest.json`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/src/index.js`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/lib/stack.d.ts`, FILE)).toBe(true);
    expect(shouldIgnore(`${rootDir}/test/stack.test.ts`, FILE)).toBe(true);

    // Files that should NOT be ignored
    expect(shouldIgnore(`${rootDir}/src/index.ts`, FILE)).toBe(false);
    expect(shouldIgnore(`${rootDir}/lib/stack.ts`, FILE)).toBe(false);
    expect(shouldIgnore(`${rootDir}/bin/app.ts`, FILE)).toBe(false);
  });
});
