import * as fs from 'fs';
import * as path from 'path';
import { MemoryStream } from './corking';

const SKIP_TESTS = fs.readFileSync(path.join(__dirname, '..', 'skip-tests.txt'), { encoding: 'utf-8' })
  .split('\n')
  .map(x => x.trim())
  .filter(x => x && !x.startsWith('#'));

if (SKIP_TESTS.length > 0) {
  process.stderr.write(`ℹ️ Skipping tests: ${JSON.stringify(SKIP_TESTS)}\n`);
}

// Whether we want to stop after the first failure, for quicker debugging (hopefully).
const FAIL_FAST = process.env.FAIL_FAST === 'true';

// Keep track of whether the suite has failed. If so, we stop running.
let failed = false;

export interface TestContext {
  readonly randomString: string;
  readonly name: string;
  readonly output: NodeJS.WritableStream;
  log(s: string): void;
}

/**
 * A wrapper for jest's 'test' which takes regression-disabled tests into account and prints a banner
 */
export function integTest(
  name: string,
  callback: (context: TestContext) => Promise<void>,
  timeoutMillis?: number,
): void {
  const runner = shouldSkip(name) ? test.skip : test;

  runner(name, async () => {
    const output = new MemoryStream();

    output.write('================================================================\n');
    output.write(`${name}\n`);
    output.write('================================================================\n');

    const now = Date.now();
    process.stderr.write(`[INTEG TEST::${name}] Starting (pid ${process.pid})...\n`);
    process.stderr.write(`[INTEG TEST::${name}] Memory Usage: ${memoryUsageReport()}`);
    try {
      if (FAIL_FAST && failed) {
        throw new Error('FAIL_FAST requested and currently failing. Stopping test early.');
      }

      return await callback({
        output,
        randomString: randomString(),
        name,
        log(s: string) {
          output.write(`${s}\n`);
        },
      });
    } catch (e: any) {
      failed = true;

      // Print the buffered output, only if the test fails.
      output.write(e.message);
      output.write(e.stack);
      process.stderr.write(`[INTEG TEST::${name}] Failed: ${e}\n`);

      const isGitHub = !!process.env.GITHUB_RUN_ID;

      if (isGitHub) {
        // GitHub Actions compatible output formatting
        // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions#setting-an-error-message
        let written = process.stderr.write(`::error title=Failed ${name}::${e.message}\n`);
        if (!written) {
          // Wait for drain
          await new Promise((ok) => process.stderr.once('drain', ok));
        }

        // Print output only if the test fails. Use 'console.log' so the output is buffered by
        // jest and prints without a stack trace (if verbose: false).
        written = process.stdout.write([
          `::group::Failure details: ${name} (click to expand)\n`,
          `${output.buffer().toString()}\n`,
          '::endgroup::\n',
        ].join(''));
        if (!written) {
          // Wait for drain
          await new Promise((ok) => process.stdout.once('drain', ok));
        }
      } else {
        // Use 'console.log' so the output is buffered by
        // jest and prints without a stack trace (if verbose: false).
        // eslint-disable-next-line no-console
        console.log(output.buffer().toString());
      }
      throw e;
    } finally {
      const duration = Date.now() - now;
      process.stderr.write(`[INTEG TEST::${name}] Done (${duration} ms).\n`);
      process.stderr.write(`[INTEG TEST::${name}] Memory Usage: ${memoryUsageReport()}`);
    }
  }, timeoutMillis);
}

function shouldSkip(testName: string) {
  return SKIP_TESTS.includes(testName);
}

// function shouldReportMemoryUsage() {
//   return process.env.INTEG_MEMORY_DEBUG === 'true';
// }

function memoryUsageReport() {
  return process.memoryUsage();
}

export function randomString() {
  // Crazy
  return Math.random().toString(36).replace(/[^a-z0-9]+/g, '');
}
