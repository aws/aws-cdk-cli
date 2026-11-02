import * as path from 'path';

/**
 * path.join, but do the right thing if the second path is absolute
 *
 * `path.join` will stick the paths together no matter what, and `path.resolve`
 * will make both absolute. This does not make the paths unnecessarily absolute,
 * but will just use the second path if it is absolute.
 */
export function absAwareJoin(one: string, two: string): string {
  if (path.isAbsolute(two)) {
    return two;
  }
  return path.join(one, two);
}

