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
}

/**
 * Creates a function that returns true if a file should be ignored.
 * A file is ignored if:
 * - It matches any exclude pattern, OR
 * - It does NOT match any include pattern
 *
 * This replicates the behavior of chokidar v3's glob pattern support.
 *
 * @param options - The include and exclude patterns
 * @returns A function that takes a file path and returns true if it should be ignored
 */
export function createIgnoreMatcher(options: GlobMatcherOptions): (filePath: string) => boolean {
  const includePatterns = options.include && options.include.length > 0 ? options.include : ['**'];
  const excludePatterns = options.exclude ?? [];

  // Compile patterns into matchers for better performance
  const picomatchOptions: picomatch.PicomatchOptions = {
    dot: true, // Match dotfiles when pattern explicitly includes them
  };

  const includeMatcher = picomatch(includePatterns, picomatchOptions);
  const excludeMatcher = excludePatterns.length > 0
    ? picomatch(excludePatterns, picomatchOptions)
    : () => false;

  return (filePath: string): boolean => {
    // Normalize path separators for cross-platform compatibility
    const normalizedPath = filePath.replace(/\\/g, '/');

    // A file is ignored if:
    // 1. It matches any exclude pattern, OR
    // 2. It does NOT match any include pattern
    if (excludeMatcher(normalizedPath)) {
      return true; // Ignore: matches exclude
    }

    if (!includeMatcher(normalizedPath)) {
      return true; // Ignore: doesn't match include
    }

    return false; // Don't ignore: matches include and doesn't match exclude
  };
}
