import * as path from 'path';
import * as fs from 'fs-extra';
import type { IntegTestInfo } from '../../lib/runner';
import { IntegSnapshotRunner } from '../../lib/runner';
import type { EngineOptions } from '../../lib/runner/engine';
import { snapshotTestWorker } from '../../lib/workers/extract';

let testSpy;
beforeEach(() => {
  testSpy = jest.spyOn(IntegSnapshotRunner.prototype, 'testSnapshot');
  jest.spyOn(process.stderr, 'write').mockImplementation(() => {
    return true;
  });
  jest.spyOn(process.stdout, 'write').mockImplementation(() => {
    return true;
  });
  jest.spyOn(fs, 'moveSync').mockImplementation(() => {
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
describe.each<Required<EngineOptions>['engine']>([
  'cli-wrapper', 'toolkit-lib',
])('Snapshot tests with engine %s', (engine) => {
  test('no snapshot -> fail', async () => {
    // WHEN
    const test: IntegTestInfo = {
      fileName: path.join(directory, 'xxxxx.integ-test1.js'),
      discoveryRoot: directory,
    };
    const result = await snapshotTestWorker(test, { engine });

    // THEN
    expect(testSpy).toHaveBeenCalledTimes(0);
    expect(result.length).toEqual(1);
    expect(result[0]).toEqual(test);
  });

  test('has snapshot -> no diff -> pass', async () => {
    // WHEN
    const test: IntegTestInfo = {
      fileName: path.join(directory, 'xxxxx.test-with-snapshot.js'),
      discoveryRoot: directory,
    };
    const result = await snapshotTestWorker(test, { engine });

    // THEN
    expect(testSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toEqual(0);
  });

  test('has snapshot -> diff -> fail', async () => {
    // WHEN
    const test: IntegTestInfo = {
      fileName: path.join(directory, 'xxxxx.test-with-snapshot-assets-diff.js'),
      discoveryRoot: directory,
    };
    const result = await snapshotTestWorker(test, { engine });

    // THEN
    expect(testSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toEqual(1);
    expect(result[0]).toEqual(test);
  });

  test('has snapshot -> test failure -> fail', async () => {
    // GIVEN
    const test: IntegTestInfo = {
      fileName: path.join(directory, 'xxxxx.test-with-snapshot-and-error.js'),
      discoveryRoot: directory,
    };

    // WHEN
    const result = await snapshotTestWorker(test, { engine });

    // THEN
    expect(testSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toEqual(1);
    expect(result[0]).toEqual(test);
  });
});

