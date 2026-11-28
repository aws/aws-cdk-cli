import { stripVTControlCharacters } from 'util';
import * as logger from '../../lib/logger';
import { DiagnosticReason, printResults } from '../../lib/workers/common';

let stderrMock: jest.SpyInstance;
beforeEach(() => {
  stderrMock = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  logger.setVerbosity(0);
  stderrMock.mockRestore();
});

function stderrOutput(): string {
  return stripVTControlCharacters(stderrMock.mock.calls.map(c => c[0]).join(''));
}

describe('printResults with -qq', () => {
  beforeEach(() => {
    logger.setVerbosity(-2);
  });

  test.each([
    DiagnosticReason.SNAPSHOT_SUCCESS,
    DiagnosticReason.TEST_SUCCESS,
    DiagnosticReason.TEST_WARNING,
    DiagnosticReason.NOT_BOOTSTRAPPED,
    DiagnosticReason.WRONG_REGION,
  ])('does not print %s', (reason) => {
    // WHEN
    printResults({ testName: 'integ.test', reason, message: 'message', duration: 1, additionalMessages: ['details'] });

    // THEN
    expect(stderrOutput()).toEqual('');
  });

  test('prints errors with their additional messages', () => {
    // WHEN
    printResults({ testName: 'integ.test', reason: DiagnosticReason.TEST_FAILED, message: 'boom', duration: 1, additionalMessages: ['Repro:'] });

    // THEN
    const output = stderrOutput();
    expect(output).toContain('FAILED     integ.test');
    expect(output).toContain('boom');
    expect(output).toContain('Repro:');
  });
});

test('printResults prints success and warnings by default', () => {
  // WHEN
  printResults({ testName: 'integ.ok', reason: DiagnosticReason.TEST_SUCCESS, message: '', duration: 1 });
  printResults({ testName: 'integ.slow', reason: DiagnosticReason.TEST_WARNING, message: 'slow', duration: 1 });

  // THEN
  const output = stderrOutput();
  expect(output).toContain('SUCCESS    integ.ok');
  expect(output).toContain('WARN       integ.slow');
});
