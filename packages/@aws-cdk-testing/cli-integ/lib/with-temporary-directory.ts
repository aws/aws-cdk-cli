import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TestContext } from './integ-test';
import { rimraf } from './shell';
import { timedSync } from './timing';

export interface TemporaryDirectoryContext {
  readonly integTestDir: string;
}

export function withTemporaryDirectory<A extends TestContext>(block: (context: A & TemporaryDirectoryContext) => Promise<void>) {
  return async (context: A) => {
    const integTestDir = path.join(os.tmpdir(), `cdk-integ-${context.randomString}`);

    fs.mkdirSync(integTestDir, { recursive: true });

    try {
      await block({
        ...context,
        integTestDir,
      });

      // Clean up in case of success
      if (process.env.SKIP_CLEANUP) {
        context.log(`Left test directory in '${integTestDir}' ($SKIP_CLEANUP)\n`);
      } else {
        // Recursive delete of the whole test tree, which for the init suites holds
        // 'node_modules' / '.venv' / NuGet 'obj' / Maven 'target'. Deleting many
        // small files is slow on Windows, and this runs inside the test's measured
        // window, so it has to be visible in the log.
        timedSync(`clean up ${integTestDir}`, context.output, () => rimraf(integTestDir));
      }
    } catch (e) {
      context.log(`Left test directory in '${integTestDir}'\n`);
      throw e;
    }
  };
}

