import { convertGlobsToChokidarV4 } from '../../lib/cli/strip-globs';

describe('convertGlobsToChokidarV4', () => {
  describe('watchPaths extraction', () => {
    test('converts "**" to current directory', () => {
      const { watchPaths } = convertGlobsToChokidarV4(['**'], []);
      expect(watchPaths).toEqual(['.']);
    });

    test('converts "**/*.js" to current directory', () => {
      const { watchPaths } = convertGlobsToChokidarV4(['**/*.js'], []);
      expect(watchPaths).toEqual(['.']);
    });

    test('converts "src/*.ts" to src directory', () => {
      const { watchPaths } = convertGlobsToChokidarV4(['src/*.ts'], []);
      expect(watchPaths).toEqual(['src']);
    });

    test('converts "./dir/**/*" to ./dir', () => {
      const { watchPaths } = convertGlobsToChokidarV4(['./dir/**/*'], []);
      expect(watchPaths).toEqual(['./dir']);
    });

    test('handles multiple include patterns', () => {
      const { watchPaths } = convertGlobsToChokidarV4(['src/**', 'lib/**'], []);
      expect(watchPaths).toEqual(['src', 'lib']);
    });

    test('deduplicates identical paths', () => {
      const { watchPaths } = convertGlobsToChokidarV4(['**/*.js', '**/*.ts'], []);
      expect(watchPaths).toEqual(['.']);
    });
  });

  describe('ignored function - exclude patterns', () => {
    test('excludes exact filename match', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['package.json']);
      expect(ignored('package.json')).toBe(true);
      expect(ignored('other.json')).toBe(false);
    });

    test('excludes "**/*.d.ts" pattern', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['**/*.d.ts']);
      expect(ignored('index.d.ts', { isFile: () => true })).toBe(true);
      expect(ignored('src/types.d.ts', { isFile: () => true })).toBe(true);
      expect(ignored('index.ts', { isFile: () => true })).toBe(false);
    });

    test('excludes "**/.*" pattern (hidden files)', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['**/.*']);
      expect(ignored('.gitignore')).toBe(true);
      expect(ignored('.env')).toBe(true);
      expect(ignored('visible.txt')).toBe(false);
    });

    test('excludes "node_modules/**" pattern', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['node_modules/**']);
      expect(ignored('node_modules')).toBe(true);
      expect(ignored('node_modules/package')).toBe(true);
      expect(ignored('node_modules/package/index.js')).toBe(true);
      expect(ignored('src/node_modules')).toBe(false);
    });

    test('excludes "**/node_modules/**" pattern', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['**/node_modules/**']);
      expect(ignored('node_modules/package')).toBe(true);
      expect(ignored('src/node_modules/package')).toBe(true);
      expect(ignored('deep/path/node_modules/file.js')).toBe(true);
    });

    test('excludes prefix pattern with "*"', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['test*']);
      expect(ignored('test.js')).toBe(true);
      expect(ignored('test-file.ts')).toBe(true);
      expect(ignored('mytest.js')).toBe(false);
    });

    test('handles multiple exclude patterns', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['**/*.d.ts', 'node_modules/**', '**/.*']);
      expect(ignored('types.d.ts', { isFile: () => true })).toBe(true);
      expect(ignored('node_modules/pkg')).toBe(true);
      expect(ignored('.hidden')).toBe(true);
      expect(ignored('src/index.ts', { isFile: () => true })).toBe(false);
    });
  });

  describe('ignored function - include patterns', () => {
    test('includes files matching "**/*.js" pattern', () => {
      const { ignored } = convertGlobsToChokidarV4(['**/*.js'], []);
      expect(ignored('index.js', { isFile: () => true })).toBe(false);
      expect(ignored('src/app.js', { isFile: () => true })).toBe(false);
      expect(ignored('index.ts', { isFile: () => true })).toBe(true);
    });

    test('includes all files with "**" pattern', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], []);
      expect(ignored('any-file.txt', { isFile: () => true })).toBe(false);
      expect(ignored('src/index.js', { isFile: () => true })).toBe(false);
    });

    test('includes files in specific directory with "dir/**/*"', () => {
      const { ignored } = convertGlobsToChokidarV4(['src/**/*'], []);
      expect(ignored('src/index.js', { isFile: () => true })).toBe(false);
      expect(ignored('src/nested/file.ts', { isFile: () => true })).toBe(false);
      expect(ignored('lib/index.js', { isFile: () => true })).toBe(true);
    });

    test('does not filter directories based on include patterns', () => {
      const { ignored } = convertGlobsToChokidarV4(['**/*.js'], []);
      expect(ignored('src', { isFile: () => false })).toBe(false);
      expect(ignored('node_modules', { isFile: () => false })).toBe(false);
    });
  });

  describe('combined include and exclude patterns', () => {
    test('includes .js files but excludes node_modules', () => {
      const { ignored } = convertGlobsToChokidarV4(['**/*.js'], ['node_modules/**']);
      expect(ignored('index.js', { isFile: () => true })).toBe(false);
      expect(ignored('node_modules/pkg/index.js', { isFile: () => true })).toBe(true);
      expect(ignored('index.ts', { isFile: () => true })).toBe(true);
    });

    test('includes all files but excludes hidden and d.ts files', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['**/.*', '**/*.d.ts']);
      expect(ignored('index.ts', { isFile: () => true })).toBe(false);
      expect(ignored('.gitignore', { isFile: () => true })).toBe(true);
      expect(ignored('types.d.ts', { isFile: () => true })).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('handles empty include patterns', () => {
      const { watchPaths } = convertGlobsToChokidarV4([], ['node_modules/**']);
      expect(watchPaths).toEqual([]);
    });

    test('handles empty exclude patterns', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], []);
      expect(ignored('any-file.txt')).toBe(false);
    });

    test('handles Windows-style paths', () => {
      const { ignored } = convertGlobsToChokidarV4(['**'], ['node_modules/**']);
      expect(ignored('node_modules\\package\\index.js')).toBe(true);
    });

    test('handles paths without stats object', () => {
      const { ignored } = convertGlobsToChokidarV4(['**/*.js'], ['node_modules/**']);
      expect(ignored('node_modules/pkg')).toBe(true);
      expect(ignored('.hidden')).toBe(false);
    });
  });
});
