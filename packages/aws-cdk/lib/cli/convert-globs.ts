interface ConvertedPatterns {
  watchPaths: string[];
  ignored: (path: string, stats?: any) => boolean;
}

/**
 * Extracts base directory from a glob pattern for watching
 */
function extractWatchPath(pattern: string): string {
  if (pattern === '**') return '.';
  if (pattern.startsWith('**/')) return '.';
  // Remove glob parts: ./dir/**/* -> ./dir, src/** -> src
  return pattern.replace(/\/\*\*.*$/, '').replace(/\/\*\.[^/]*$/, '') || '.';
}

/**
 * Checks if a path matches an include pattern
 */
function matchesIncludePattern(normalized: string, basename: string, pathParts: string[], pattern: string): boolean {
  // Non-glob patterns: match if path starts with the pattern
  if (!pattern.includes('*')) {
    return normalized.startsWith(pattern + '/') || normalized === pattern;
  }
  // Glob patterns
  if (pattern === '**') return true;
  if (pattern.startsWith('**/*.')) {
    return basename.endsWith(pattern.slice(4));
  }
  if (pattern.endsWith('/**/*')) {
    const dir = pattern.slice(0, -5);
    return !dir || normalized.startsWith(dir + '/');
  }
  if (pattern.startsWith('**/') && pattern.endsWith('/*')) {
    // Match files directly in a directory anywhere (e.g., **/my-dir2/*)
    const dirName = pattern.slice(3, -2);
    return pathParts.includes(dirName);
  }
  return true;
}

/**
 * Checks if a path matches an exclude pattern
 */
function matchesExcludePattern(normalized: string, basename: string, pathParts: string[], pattern: string): boolean {
  if (!pattern.includes('*')) return basename === pattern;
  if (pattern.startsWith('**/*.')) return basename.endsWith(pattern.slice(4));
  if (pattern === '**/.*') return basename.startsWith('.');
  if (pattern === '**/.*/**') {
    // Match files inside hidden directories
    return pathParts.some(part => part.startsWith('.'));
  }
  if (pattern.startsWith('**/') && pattern.endsWith('/**')) {
    return pathParts.includes(pattern.slice(3, -3));
  }
  if (pattern.startsWith('**/')) {
    // Match directory name anywhere in path (e.g., **/my-dir2)
    const dirName = pattern.slice(3);
    return pathParts.includes(dirName);
  }
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3);
    return normalized === dir || normalized.startsWith(dir + '/');
  }
  if (pattern.endsWith('*')) return basename.startsWith(pattern.slice(0, -1));
  return false;
}

/**
 * Converts glob patterns to Chokidar v4 compatible watch paths and ignore function.
 *
 * Chokidar v4 dropped support for glob patterns in watch() and ignored options.
 * This function extracts base directories from include patterns and creates an
 * ignored function that evaluates both include and exclude patterns.
 *
 * @param includePatterns - Array of glob patterns to include (e.g., ['**', 'src/*.ts'])
 * @param excludePatterns - Array of glob patterns to exclude (e.g., ['node_modules', '**\/*.d.ts'])
 * @returns Object with watchPaths array and ignored function for Chokidar v4
 */
export function convertGlobsToChokidarV4(
  includePatterns: string[],
  excludePatterns: string[],
): ConvertedPatterns {
  const watchPaths = includePatterns.map(extractWatchPath);

  const ignored = (path: string, stats?: any): boolean => {
    const normalized = path.replace(/\\/g, '/');
    const basename = path.split(/[/\\]/).pop() || '';
    const pathParts = normalized.split('/');

    // Check include patterns - if file doesn't match any include, ignore it
    if (includePatterns.length > 0 && stats?.isFile()) {
      const matchesInclude = includePatterns.some(pattern =>
        matchesIncludePattern(normalized, basename, pathParts, pattern),
      );
      if (!matchesInclude) return true;
    }

    // Check exclude patterns
    return excludePatterns.some(pattern =>
      matchesExcludePattern(normalized, basename, pathParts, pattern),
    );
  };

  return { watchPaths: [...new Set(watchPaths)], ignored };
}
