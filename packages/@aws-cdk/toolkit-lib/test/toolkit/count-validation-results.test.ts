import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import type { ValidateResult } from '../../lib/actions/validate';
import type { IMessageSpan } from '../../lib/api/io/private/span';
import { countValidationResults } from '../../lib/toolkit/private/count-validation-results';

let span: IMessageSpan<any>;
let counters: Record<string, number>;

beforeEach(() => {
  counters = {};
  span = {
    incCounter: (name: string, delta: number = 1) => {
      counters[name] = (counters[name] ?? 0) + delta;
    },
  } as IMessageSpan<any>;
});

function report(pluginName: string, conclusion: 'success' | 'failure', severities: string[]): PluginReportJson {
  return {
    pluginName,
    conclusion,
    violations: severities.map((severity) => ({
      ruleName: 'some-rule',
      description: 'some description',
      severity: severity as any,
      violatingConstructs: [],
    })),
  };
}

function result(offlineReports: PluginReportJson[], onlineReports: PluginReportJson[] = []): ValidateResult {
  const pluginReports = [...offlineReports, ...onlineReports];
  return {
    conclusion: pluginReports.some((r) => r.conclusion === 'failure') ? 'failure' : 'success',
    pluginReports,
    onlineReports,
  };
}

test('counts offline violations per severity', () => {
  countValidationResults(span, result([
    report('SomePlugin', 'failure', ['error', 'error', 'warning']),
    report('Construct Annotations', 'success', ['warning', 'info']),
  ]));

  expect(counters).toEqual({
    'offlineViolations:error': 2,
    'offlineViolations:warning': 2,
    'offlineViolations:info': 1,
    'onlineViolations': 0,
    'offlineWouldFailDeploy': 1,
  });
});

test('online violations are counted separately from offline severities', () => {
  countValidationResults(span, result([], [
    report('CloudFormation', 'failure', ['fatal', 'fatal']),
  ]));

  expect(counters).toEqual({
    onlineViolations: 2,
    offlineWouldFailDeploy: 0,
  });
});

test('an offline plugin named CloudFormation is still counted as offline', () => {
  countValidationResults(span, result([
    report('CloudFormation', 'failure', ['error']),
  ]));

  expect(counters).toEqual({
    'offlineViolations:error': 1,
    'onlineViolations': 0,
    'offlineWouldFailDeploy': 1,
  });
});

test('reports without onlineReports on the result are all counted as offline', () => {
  countValidationResults(span, {
    conclusion: 'failure',
    pluginReports: [report('CloudFormation', 'failure', ['error'])],
  });

  expect(counters).toEqual({
    'offlineViolations:error': 1,
    'onlineViolations': 0,
    'offlineWouldFailDeploy': 1,
  });
});

test('offlineWouldFailDeploy is 0 when offline reports succeed', () => {
  countValidationResults(span, result([
    report('SomePlugin', 'success', ['warning']),
  ]));

  expect(counters).toEqual({
    'offlineViolations:warning': 1,
    'onlineViolations': 0,
    'offlineWouldFailDeploy': 0,
  });
});

test('no reports produce zero counters', () => {
  countValidationResults(span, result([]));

  expect(counters).toEqual({
    onlineViolations: 0,
    offlineWouldFailDeploy: 0,
  });
});
