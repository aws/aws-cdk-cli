import type { Stats } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import picomatch = require('picomatch');

/**
 * Options for creating a glob matcher
 */
export interface GlobMatcherOptions {
  /**
   * Patterns for files to include (glob patterns)
   * @default ['**'] - match all files
   */
  include?: string[];

  /**
   * Patterns for files to exclude (glob patterns)
   */
  exclude?: string[];

  /**
   * The root directory for matching. If provided, absolute paths will be
   * converted to relative paths before matching against patterns.
   * This is necessary because chokidar v4 passes absolute paths to the
   * ignored callback even when a cwd is specified.
   */
  rootDir?: string;
}

/**
 * Normalizes a pattern to ensure it matches files within directories.
 * If a pattern doesn't contain glob characters, it's treated as a directory
 * and `/**` is appended to match all files within it.
 *
 * @param pattern - The pattern to normalize
 * @returns The normalized pattern
 */
function normalizePattern(pattern: string): string {
  // If pattern already contains glob characters, use as-is
  if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[')) {
    return pattern;
  }
  // Otherwise, treat as a directory and match all files within
  // Remove trailing slash if present, then append /**
  const normalized = pattern.replace(/\/+$/, '');
  return `${normalized}/**`;
}

/**
 * Builds the list of directory-prefix globs for an include pattern.
 *
 * A pattern like `src/**\/*.ts` only matches files (e.g. `src/a.ts`), never the
 * directories that contain them (`src`, `src/sub`). But chokidar v4 uses the
 * `ignored` callback to decide whether to *descend* into a directory: if a
 * directory is ignored, its entire subtree is pruned and no nested file is ever
 * discovered. We must therefore allow traversal of any directory that could be
 * an ancestor of a matching file.
 *
 * We derive those ancestors from the progressive `/`-delimited prefixes of the
 * pattern: `src/**\/*.ts` yields `src`, `src/**`, `src/**\/*.ts`. Matching a
 * directory path against this set answers "could a matching file live under
 * here?" without touching the filesystem.
 *
 * @param pattern - A normalized include pattern
 * @returns The progressive prefix globs of the pattern
 */
function directoryPrefixGlobs(pattern: string): string[] {
  const segments = pattern.split('/');
  const prefixes: string[] = [];
  for (let i = 1; i <= segments.length; i++) {
    prefixes.push(segments.slice(0, i).join('/'));
  }
  return prefixes;
}

/**
 * Creates a function that returns true if a path should be ignored by chokidar.
 *
 * The function is used as chokidar v4's `ignored` callback, which is consulted
 * both for files (to decide whether to watch them) and for directories (to
 * decide whether to descend into them). Chokidar v4 removed native glob support,
 * so this replicates chokidar v3's behavior using picomatch.
 *
 * The path is classified using the `Stats` chokidar provides (when available):
 * - Exclude patterns always take precedence and prune both files and directories.
 * - A **directory** is only pruned by excludes. It is never ignored merely for
 *   failing the include filter, because nested files may still match — pruning
 *   it would silently drop the entire subtree (the root cause of the original
 *   bug where `include: ['src/**\/*.ts']` matched nothing).
 * - A **file** must match an include pattern to be watched.
 * - When `Stats` is absent (chokidar invokes the callback both with and without
 *   stats during traversal), the path is kept if it either matches a file
 *   include pattern or is a potential ancestor directory of one.
 *
 * @param options - The include and exclude patterns
 * @returns A function that takes a path (and optional stats) and returns true if it should be ignored
 */
export function createIgnoreMatcher(options: GlobMatcherOptions): (filePath: string, stats?: Stats) => boolean {
  const includePatterns = options.include && options.include.length > 0
    ? options.include.map(normalizePattern)
    : ['**'];
  const excludePatterns = (options.exclude ?? []).map(normalizePattern);
  const rootDir = options.rootDir ? options.rootDir.replace(/\\/g, '/').replace(/\/+$/, '') : undefined;

  // Compile patterns into matchers for better performance
  const picomatchOptions: picomatch.PicomatchOptions = {
    dot: true, // Match dotfiles when pattern explicitly includes them
  };

  const includeMatcher = picomatch(includePatterns, picomatchOptions);
  // Matches a directory that could be an ancestor of an included file, so we
  // don't prune subtrees before discovering the files we actually want.
  const directoryMatcher = picomatch(includePatterns.flatMap(directoryPrefixGlobs), picomatchOptions);
  const excludeMatcher = excludePatterns.length > 0
    ? picomatch(excludePatterns, picomatchOptions)
    : () => false;

  return (filePath: string, stats?: Stats): boolean => {
    // Normalize path separators for cross-platform compatibility
    let normalizedPath = filePath.replace(/\\/g, '/');

    // If rootDir is provided and the path appears to be absolute, make it relative
    // This is necessary because chokidar v4 passes absolute paths to the
    // ignored callback even when a cwd is specified
    if (rootDir) {
      if (normalizedPath.startsWith(rootDir + '/')) {
        normalizedPath = normalizedPath.slice(rootDir.length + 1);
      } else if (normalizedPath === rootDir) {
        // The root directory itself - don't ignore it
        return false;
      }
    }

    // Excludes always take precedence, for both files and directories.
    if (excludeMatcher(normalizedPath)) {
      return true; // Ignore: matches exclude
    }

    // A directory is kept if it could be an ancestor of an included file, so we
    // descend into it and discover the nested files we actually want. It is
    // never pruned merely for failing the file-level include filter (it can't
    // match a pattern like 'src/**\/*.ts'), which would drop the entire subtree.
    if (stats?.isDirectory()) {
      return !directoryMatcher(normalizedPath);
    }

    // Files must match an include pattern.
    if (stats?.isFile()) {
      return !includeMatcher(normalizedPath);
    }

    // No stats available: chokidar consults the callback both with and without
    // stats during traversal. Keep the path if it matches a file include
    // pattern, or if it could be an ancestor directory of an included file.
    return !(includeMatcher(normalizedPath) || directoryMatcher(normalizedPath));
  };
}
