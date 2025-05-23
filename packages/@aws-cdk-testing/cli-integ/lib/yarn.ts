import * as path from 'path';
import { shell } from './shell';

/**
 * Cache monorepo discovery results, we only want to do this once per run
 */
const YARN_MONOREPO_CACHE: Record<string, any> = {};

/**
 * Return a { name -> directory } packages found in a Yarn monorepo
 *
 * Cached in YARN_MONOREPO_CACHE.
 */
export async function findYarnPackages(root: string): Promise<Record<string, string>> {
  if (!(root in YARN_MONOREPO_CACHE)) {
    const outputDataString: string = JSON.parse(await shell(['yarn', 'workspaces', '--json', 'info'], {
      captureStderr: false,
      cwd: root,
      show: 'error',
    })).data;
    const output: YarnWorkspacesOutput = JSON.parse(outputDataString);

    const ret: Record<string, string> = {};
    for (const [k, v] of Object.entries(output)) {
      ret[k] = path.join(root, v.location);
    }
    YARN_MONOREPO_CACHE[root] = ret;
  }
  return YARN_MONOREPO_CACHE[root];
}

type YarnWorkspacesOutput = Record<string, { location: string }>;
