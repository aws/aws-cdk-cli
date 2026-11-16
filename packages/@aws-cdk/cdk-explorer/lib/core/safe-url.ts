/* eslint-disable no-restricted-imports */
import { pathToFileURL as _pathToFileURL } from 'node:url';
import type { RelativePath } from './assembly-index-with-source-locations';
import type { NotBranded } from './type-brands';

/**
 * Do not allow calling this function on relative URLs
 *
 * Force making the path absolute first.
 */
export function pathToFileURL<T extends string>(path: NotBranded<T, RelativePath>): URL {
  return _pathToFileURL(path);
}
