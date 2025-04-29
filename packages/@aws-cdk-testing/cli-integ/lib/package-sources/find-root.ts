import * as path from 'path';
import { findUp } from '../files';

/**
 * Find the root directory of the repo from the current directory
 *
 * We look for a file that is present only in the root of our AWS CDK CLI repository.
 */
export async function autoFindRepoRoot() {
  const found = findUp('yarn.lock');
  if (!found) {
    throw new Error(`Could not determine repository root: 'yarn.lock' not found from ${process.cwd()}`);
  }
  return path.dirname(found);
}

