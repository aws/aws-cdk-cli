import * as path from 'path';
import { stripVTControlCharacters } from 'util';
import fs from 'fs-extra';
import type * as workerpool from 'workerpool';
import * as logger from '../../lib/logger';
import type { IntegTestInfo } from '../../lib/runner/integration-tests';
import { IntegTest } from '../../lib/runner/integration-tests';
import type { Diagnostic } from '../../lib/workers/common';
import { DiagnosticReason } from '../../lib/workers/common';
import { snapshotTestWorker } from '../../lib/workers/extract';
import { runSnapshotTests } from '../../lib/workers/integ-snapshot-worker';

jest.setTimeout(20_000);

beforeEach(() => {
  jest.spyOn(process.stderr, 'write').mockImplementation(() => {
    return true;
  });
  jest.spyOn(process.stdout, 'write').mockImplementation(() => {
    return true;
  });
  jest.spyOn(fs, 'moveSync').mockImplementation(() => {
    return true;
  });
  jest.spyOn(fs, 'removeSync').mockImplementation(() => {
    return true;
  });
  jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
    return true;
  });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

const directory = path.join(__dirname, '..', 'test-data');
describe('Snapshot tests', () => {
  test('no snapshot', async () => {
    // WHEN
    const test = {
      fileName: path.join(directory, 'xxxxx.integ-test1.js'),
      discoveryRoot: directory,
    };
    const result = await snapshotTestWorker(test, { testingUsingMocksLeaveDirectories: true });

    // THEN
    expect(result.length).toEqual(1);
    expect(result[0]).toEqual(test);
  });

  test('has snapshot', async () => {
    // WHEN
    const test = {
      fileName: path.join(directory, 'xxxxx.test-with-snapshot.js'),
      discoveryRoot: directory,
    };
    const result = await snapshotTestWorker(test, { testingUsingMocksLeaveDirectories: true });

    // THEN
    expect(result.length).toEqual(1);
  });

  test('failed snapshot', async () => {
    // WHEN
    const test = {
      fileName: path.join(directory, 'xxxxx.test-with-snapshot-assets-diff.js'),
      discoveryRoot: directory,
      destructiveChanges: [],
    };
    const result = await snapshotTestWorker(test, { testingUsingMocksLeaveDirectories: true });

    // THEN
    expect(result.length).toEqual(1);
    expect(result[0]).toEqual(test);
  });
});

describe('runSnapshotTests output', () => {
  const unchangedTest = new IntegTest({ fileName: path.join(directory, 'unchanged.js'), discoveryRoot: directory });
  const changedTest = new IntegTest({ fileName: path.join(directory, 'changed.js'), discoveryRoot: directory });

  // Fake pool that reports an unchanged snapshot for one test and a changed snapshot for the other
  const pool = {
    exec: async (_method: string, [info]: [IntegTestInfo], { on }: { on: (d: Diagnostic) => void }) => {
      const testName = new IntegTest(info).testName;
      if (testName === unchangedTest.testName) {
        on({ testName, reason: DiagnosticReason.SNAPSHOT_SUCCESS, message: 'Success', duration: 1 });
        return [];
      }
      on({ testName, reason: DiagnosticReason.SNAPSHOT_FAILED, message: 'diff', duration: 1 });
      return [info];
    },
  } as unknown as workerpool.WorkerPool;

  function stderrOutput(): string {
    return stripVTControlCharacters((process.stderr.write as unknown as jest.Mock).mock.calls.map(c => c[0]).join(''));
  }

  test('prints every unchanged test by default', async () => {
    // WHEN
    const failed = await runSnapshotTests(pool, [unchangedTest, changedTest], {});

    // THEN
    expect(failed).toEqual([changedTest.info]);
    const output = stderrOutput();
    expect(output).toContain(`UNCHANGED  ${unchangedTest.testName}`);
    expect(output).toContain(`CHANGED    ${changedTest.testName}`);
    expect(output).toContain('Tests:    1 failed, 2 total');
  });

  test('-q replaces unchanged tests with a count in the summary', async () => {
    // WHEN
    const failed = await runSnapshotTests(pool, [unchangedTest, unchangedTest, changedTest], {}, { verbosity: -1 });

    // THEN
    expect(failed).toEqual([changedTest.info]);
    const output = stderrOutput();
    expect(output).toContain('Verifying integration test snapshots');
    expect(output).not.toContain(`UNCHANGED  ${unchangedTest.testName}`);
    expect(output).toContain(`CHANGED    ${changedTest.testName}`);
    expect(output).toContain('Tests:    1 failed, 2 unchanged, 3 total');
  });

  test('-q without failures', async () => {
    // WHEN
    await runSnapshotTests(pool, [unchangedTest], {}, { verbosity: -1 });

    // THEN
    expect(stderrOutput()).toContain('Tests:    1 unchanged, 1 total');
  });

  test('-qq only prints errors and the summary', async () => {
    // GIVEN
    logger.setVerbosity(-2);

    try {
      // WHEN
      await runSnapshotTests(pool, [unchangedTest, changedTest], {}, { verbosity: -2 });
    } finally {
      logger.setVerbosity(0);
    }

    // THEN
    const output = stderrOutput();
    expect(output).not.toContain('Verifying integration test snapshots');
    expect(output).not.toContain(`UNCHANGED  ${unchangedTest.testName}`);
    expect(output).toContain(`CHANGED    ${changedTest.testName}`);
    expect(output).toContain('Snapshot Results');
    expect(output).toContain('Tests:    1 failed, 1 unchanged, 2 total');
  });
});
