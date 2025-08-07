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
  reportWaitTime(ms: number): void;
}

/**
 * Retry wrapper that executes a test callback up to maxAttempts times
 *
 * If any attempt succeeds, it returns immediately. If all attempts fail,
 * it throws the last error encountered.
 */
export function withRetry<T extends TestContext>(
  callback: (context: T) => Promise<void>,
  maxAttempts: number = 2,
): (context: T) => Promise<void> {
  return async (context: T) => {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await callback(context);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          context.log(`Attempt ${attempt}/${maxAttempts} failed: ${error}. Retrying...`);
        }
      }
    }

    throw lastError;
  };
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

    const start = Date.now();
    let waitTime = 0;

    process.stderr.write(`[INTEG TEST::${name}] Starting (pid ${process.pid})...\n`);
    maybePrintMemoryUsage(name);
    try {
      if (FAIL_FAST && failed) {
        throw new Error('FAIL_FAST requested and currently failing. Stopping test early.');
      }

      const ret = await callback({
        output,
        randomString: randomString(),
        name,
        log(s: string) {
          output.write(`${s}\n`);
        },
        reportWaitTime(n) {
          waitTime += n;
        },
      });

      await writeLog(name, {
        success: true,
        output: output.toString(),
        totalDuration: Date.now() - start,
        waitTime,
      });

      return ret;
    } catch (e: any) {
      // Print the buffered output, only if the test fails.
      failed = true;

      output.write(e.message);
      output.write(e.stack);

      await writeLog(name, {
        success: false,
        output: output.toString(),
        totalDuration: Date.now() - start,
        waitTime,
      });
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
      const duration = Date.now() - start;
      process.stderr.write(`[INTEG TEST::${name}] Done (${humanTime(duration)}).\n`);
      maybePrintMemoryUsage(name);
    }
  }, timeoutMillis);
}

function shouldSkip(testName: string) {
  return SKIP_TESTS.includes(testName);
}

function maybePrintMemoryUsage(testName: string) {
  if (process.env.INTEG_MEMORY_DEBUG !== 'true') {
    return;
  }
  const memoryUsage = process.memoryUsage() as any;
  const report: any = {};
  for (const [key, value] of Object.entries(memoryUsage)) {
    report[key] = `${Math.round(value as number / 1024 / 1024)} MB`;
  }
  process.stderr.write(`[INTEG TEST::${testName}] Memory Usage: ${JSON.stringify(report)}`);
}

export function randomString() {
  // Crazy
  return Math.random().toString(36).replace(/[^a-z0-9]+/g, '');
}

/**
 * Write log files
 *
 * Write a text log to `${INTEG_LOGS}/[FAILED-]description-of-test.txt`, and a single
 * line of a Markdown table to `${INTEG_LOGS}/md/1-description-of-test.md`.
 *
 * The latter are designed to be globcatted to $GITHUB_STEP_SUMMARY after tests
 * (we don't write there directly to avoid concurrency issues with multiple processes
 * reading and mutating the same file).
 *
 * We do use `atomicWrite` to write files -- it's only necessary for the header file,
 * which gets overwritten by every test, just to make sure it properly exists (shouldn't
 * end up empty or with interleaved contents). The other writes are not
 * contended and don't need to be atomic, but the function is just ergonomic to use.
 */
async function writeLog(testName: string, result: {
  success: boolean;
  output: string;
  totalDuration: number;
  waitTime: number;
}) {
  if (process.env.INTEG_LOGS) {
    // Write the log file
    const slug = slugify(testName);
    const logFileName = `${process.env.INTEG_LOGS}/${result.success ? '' : 'FAILED-'}${slug}.txt`;
    await atomicWrite(logFileName, result.output);

    // Write a row for the markdown table
    // Sort failures before successes, and the table header before all
    const mdFileName = `${process.env.INTEG_LOGS}/md/${result.success ? '2' : '1'}-${slug}.md`;
    const columns: Array<[string, string]> = [
      ['Result', result.success ? 'pass ✅' : 'fail ❌'],
      ['Test Name', testName],
      ['Test Duration', humanTime(result.totalDuration - result.waitTime)],
      ['Wait Time', result.waitTime > 0 ? humanTime(result.waitTime) : '-'],
    ];
    await atomicWrite(`${process.env.INTEG_LOGS}/md/0-header.md`, [
      `| ${columns.map(([col, _val]) => col).join(' | ')} |`,
      `| ${columns.map(() => '-----------').join(' | ')} |`,
    ].map(x => `${x}\n`).join(''));
    await atomicWrite(mdFileName,
      `| ${columns.map(([_col, val]) => val).join(' | ')} |\n`);
  }
}

function humanTime(delta: number) {
  const components = [];

  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;

  const hours = Math.floor(delta / H);
  if (hours > 0) {
    components.push(`${hours}h`);
    delta -= hours * H;
  }
  const minutes = Math.floor(delta / M);
  if (minutes > 0) {
    components.push(`${minutes}m`);
    delta -= minutes * M;
  }
  const seconds = Math.floor(delta / S);
  if (seconds > 0) {
    components.push(`${seconds}s`);
    delta -= seconds * S;
  }
  components.push(`${delta}ms`);

  // Retain the 2 most significant components
  return components.slice(0, 2).join('');
}

function slugify(x: string) {
  return x.replace(/[^a-zA-Z0-9_,]+/g, '-');
}

async function atomicWrite(fileName: string, contents: string) {
  await fs.promises.mkdir(path.dirname(fileName), { recursive: true });

  const tmp = `${fileName}.${process.pid}`;
  await fs.promises.writeFile(tmp, contents);
  await fs.promises.rename(tmp, fileName);
}
