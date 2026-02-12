import { createIgnoreMatcher } from '../../lib/util/glob-matcher';

describe('glob-matcher', () => {
  describe('createIgnoreMatcher', () => {
    describe('default behavior', () => {
      test('matches all files when no patterns specified', () => {
        const shouldIgnore = createIgnoreMatcher({});

        // Should NOT ignore any files (default include is **)
        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('deep/nested/path/file.ts')).toBe(false);
      });

      test('matches all files when include is empty array', () => {
        const shouldIgnore = createIgnoreMatcher({ include: [] });

        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);
      });
    });

    describe('include patterns', () => {
      test('matches files with ** pattern', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**'] });

        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('a/b/c/d/file.ts')).toBe(false);
      });

      test('matches TypeScript files with **/*.ts pattern', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**/*.ts'] });

        // Should NOT ignore .ts files
        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('deep/nested/file.ts')).toBe(false);

        // Should ignore non-.ts files
        expect(shouldIgnore('file.js')).toBe(true);
        expect(shouldIgnore('file.json')).toBe(true);
        expect(shouldIgnore('README.md')).toBe(true);
      });

      test('matches files in specific directory with src/** pattern', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['src/**'] });

        // Should NOT ignore files in src/
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('src/nested/file.ts')).toBe(false);

        // Should ignore files outside src/
        expect(shouldIgnore('file.ts')).toBe(true);
        expect(shouldIgnore('test/file.ts')).toBe(true);
        expect(shouldIgnore('lib/file.ts')).toBe(true);
      });

      test('supports multiple include patterns', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['**/*.ts', '**/*.js'],
        });

        // Should NOT ignore .ts and .js files
        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('file.js')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('src/file.js')).toBe(false);

        // Should ignore other files
        expect(shouldIgnore('file.json')).toBe(true);
        expect(shouldIgnore('file.md')).toBe(true);
      });
    });

    describe('exclude patterns', () => {
      test('excludes files matching exclude pattern', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['**/node_modules/**'],
        });

        // Should ignore node_modules
        expect(shouldIgnore('node_modules/package/index.js')).toBe(true);
        expect(shouldIgnore('src/node_modules/package/index.js')).toBe(true);

        // Should NOT ignore other files
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('file.ts')).toBe(false);
      });

      test('excludes dotfiles with .* pattern', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['.*'],
        });

        // Should ignore dotfiles at root
        expect(shouldIgnore('.gitignore')).toBe(true);
        expect(shouldIgnore('.eslintrc')).toBe(true);

        // Should NOT ignore regular files
        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);
      });

      test('excludes nested dotfiles with **/.*/** pattern', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['**/.*/**'],
        });

        // Should ignore files inside dot directories
        expect(shouldIgnore('.git/config')).toBe(true);
        expect(shouldIgnore('src/.hidden/file.ts')).toBe(true);

        // Should NOT ignore regular files
        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);
      });

      test('supports multiple exclude patterns', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts'],
        });

        // Should ignore all excluded patterns
        expect(shouldIgnore('node_modules/pkg/index.js')).toBe(true);
        expect(shouldIgnore('dist/bundle.js')).toBe(true);
        expect(shouldIgnore('src/file.test.ts')).toBe(true);

        // Should NOT ignore other files
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('lib/index.ts')).toBe(false);
      });
    });

    describe('combined include and exclude', () => {
      test('exclude takes precedence over include', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['**/*.ts'],
          exclude: ['**/*.test.ts'],
        });

        // Should NOT ignore regular .ts files
        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);

        // Should ignore .test.ts files (exclude wins)
        expect(shouldIgnore('file.test.ts')).toBe(true);
        expect(shouldIgnore('src/file.test.ts')).toBe(true);

        // Should ignore non-.ts files (not in include)
        expect(shouldIgnore('file.js')).toBe(true);
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
        expect(shouldIgnore('src/index.ts')).toBe(false);
        expect(shouldIgnore('lib/stack.ts')).toBe(false);
        expect(shouldIgnore('bin/app.ts')).toBe(false);

        // Should ignore node_modules
        expect(shouldIgnore('node_modules/aws-cdk/index.js')).toBe(true);

        // Should ignore cdk.out
        expect(shouldIgnore('cdk.out/manifest.json')).toBe(true);

        // Should ignore dotfiles
        expect(shouldIgnore('.gitignore')).toBe(true);
        expect(shouldIgnore('.git/config')).toBe(true);
      });
    });

    describe('path normalization', () => {
      test('normalizes Windows-style paths', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['src/**/*.ts'],
        });

        // Should handle backslashes (Windows paths)
        expect(shouldIgnore('src\\file.ts')).toBe(false);
        expect(shouldIgnore('src\\nested\\file.ts')).toBe(false);
      });
    });

    describe('edge cases', () => {
      test('handles empty string path', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**'] });
        // Empty path doesn't match ** pattern
        expect(shouldIgnore('')).toBe(true);
      });

      test('handles paths with special characters', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**'] });

        expect(shouldIgnore('file with spaces.ts')).toBe(false);
        expect(shouldIgnore('file-with-dashes.ts')).toBe(false);
        expect(shouldIgnore('file_with_underscores.ts')).toBe(false);
      });

      test('handles deeply nested paths', () => {
        const shouldIgnore = createIgnoreMatcher({ include: ['**/*.ts'] });

        expect(shouldIgnore('a/b/c/d/e/f/g/h/i/j/file.ts')).toBe(false);
        expect(shouldIgnore('a/b/c/d/e/f/g/h/i/j/file.js')).toBe(true);
      });

      test('handles root-level files', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['**/*.ts'],
          exclude: ['**/test/**'],
        });

        expect(shouldIgnore('index.ts')).toBe(false);
        expect(shouldIgnore('app.ts')).toBe(false);
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
        expect(shouldIgnore('my-dir/file.ts')).toBe(false);
        expect(shouldIgnore('my-dir/nested/file.ts')).toBe(false);

        // Should ignore files outside my-dir
        expect(shouldIgnore('other-dir/file.ts')).toBe(true);
        expect(shouldIgnore('file.ts')).toBe(true);
      });

      test('directory name without glob is treated as directory/** for exclude', () => {
        const shouldIgnore = createIgnoreMatcher({
          exclude: ['my-dir'],
        });

        // Should ignore files inside my-dir
        expect(shouldIgnore('my-dir/file.ts')).toBe(true);
        expect(shouldIgnore('my-dir/nested/file.ts')).toBe(true);

        // Should NOT ignore files outside my-dir
        expect(shouldIgnore('other-dir/file.ts')).toBe(false);
        expect(shouldIgnore('file.ts')).toBe(false);
      });

      test('directory with trailing slash is normalized', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['my-dir/'],
        });

        // Should NOT ignore files inside my-dir
        expect(shouldIgnore('my-dir/file.ts')).toBe(false);
        expect(shouldIgnore('my-dir/nested/file.ts')).toBe(false);

        // Should ignore files outside my-dir
        expect(shouldIgnore('other-dir/file.ts')).toBe(true);
      });

      test('patterns with glob characters are not normalized', () => {
        // Patterns with *, ?, or [ should be used as-is
        const shouldIgnore = createIgnoreMatcher({
          include: ['src/*.ts'], // Only matches .ts files directly in src/
        });

        // Should NOT ignore .ts files directly in src/
        expect(shouldIgnore('src/file.ts')).toBe(false);

        // Should ignore nested .ts files (pattern doesn't have **)
        expect(shouldIgnore('src/nested/file.ts')).toBe(true);

        // Should ignore non-.ts files
        expect(shouldIgnore('src/file.js')).toBe(true);
      });

      test('dot pattern is treated as directory', () => {
        // The '.' pattern should match all files (becomes './**')
        const shouldIgnore = createIgnoreMatcher({
          include: ['.'],
        });

        expect(shouldIgnore('file.ts')).toBe(false);
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('deep/nested/file.ts')).toBe(false);
      });

      test('multiple directory patterns work together', () => {
        const shouldIgnore = createIgnoreMatcher({
          include: ['src', 'lib'],
        });

        // Should NOT ignore files in src/ or lib/
        expect(shouldIgnore('src/file.ts')).toBe(false);
        expect(shouldIgnore('lib/file.ts')).toBe(false);
        expect(shouldIgnore('src/nested/file.ts')).toBe(false);

        // Should ignore files outside src/ and lib/
        expect(shouldIgnore('test/file.ts')).toBe(true);
        expect(shouldIgnore('file.ts')).toBe(true);
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
    expect(shouldIgnore(`${rootDir}/README.md`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.json`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.context.json`)).toBe(true);

    // Non-excluded files should NOT be ignored
    expect(shouldIgnore(`${rootDir}/src/index.ts`)).toBe(false);
    expect(shouldIgnore(`${rootDir}/lib/stack.ts`)).toBe(false);
  });

  test('handles the root directory itself', () => {
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md'],
      rootDir,
    });

    // The root directory itself should NOT be ignored
    expect(shouldIgnore(rootDir)).toBe(false);
  });

  test('still works with relative paths when rootDir is provided', () => {
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md', 'cdk*.json'],
      rootDir,
    });

    // Relative paths should still work
    expect(shouldIgnore('README.md')).toBe(true);
    expect(shouldIgnore('cdk.json')).toBe(true);
    expect(shouldIgnore('src/index.ts')).toBe(false);
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
    expect(shouldIgnore('/other/path/README.md')).toBe(false); // Matches ** but not excluded
    expect(shouldIgnore('/other/path/file.ts')).toBe(false); // Matches **
  });

  test('handles Windows-style rootDir', () => {
    const windowsRootDir = 'C:\\Users\\test\\my-project';
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md'],
      rootDir: windowsRootDir,
    });

    // Windows paths should be normalized and converted to relative
    expect(shouldIgnore('C:/Users/test/my-project/README.md')).toBe(true);
    expect(shouldIgnore('C:/Users/test/my-project/src/index.ts')).toBe(false);
  });

  test('handles rootDir with trailing slash', () => {
    const shouldIgnore = createIgnoreMatcher({
      include: ['**'],
      exclude: ['README.md'],
      rootDir: '/Users/test/my-project/',
    });

    expect(shouldIgnore('/Users/test/my-project/README.md')).toBe(true);
    expect(shouldIgnore('/Users/test/my-project/src/index.ts')).toBe(false);
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
    expect(shouldIgnore(`${rootDir}/README.md`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.json`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.context.json`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/package.json`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/yarn.lock`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/tsconfig.json`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/node_modules/pkg/index.js`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/.gitignore`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/.git/config`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/cdk.out/manifest.json`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/src/index.js`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/lib/stack.d.ts`)).toBe(true);
    expect(shouldIgnore(`${rootDir}/test/stack.test.ts`)).toBe(true);

    // Files that should NOT be ignored
    expect(shouldIgnore(`${rootDir}/src/index.ts`)).toBe(false);
    expect(shouldIgnore(`${rootDir}/lib/stack.ts`)).toBe(false);
    expect(shouldIgnore(`${rootDir}/bin/app.ts`)).toBe(false);
  });
});
