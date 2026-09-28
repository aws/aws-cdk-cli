import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import type { IMessageSpan } from '../../lib/api/io/private/span';
import { countOnlineValidationResults } from '../../lib/toolkit/private/count-validation-results';

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

describe('countOnlineValidationResults', () => {
  test('counts online violations and records incomplete stacks', () => {
    countOnlineValidationResults(span, [
      report('CloudFormation', 'failure', ['fatal', 'fatal']),
    ], 0);

    expect(counters).toEqual({ 'onlineViolations': 2, 'online:stacksIncomplete': 0 });
  });

  test('records the number of stacks that could not be validated', () => {
    countOnlineValidationResults(span, [], 3);

    expect(counters).toEqual({ 'onlineViolations': 0, 'online:stacksIncomplete': 3 });
  });

  test('always emits both counters, even for undefined online reports', () => {
    countOnlineValidationResults(span, undefined, 0);

    expect(counters).toEqual({ 'onlineViolations': 0, 'online:stacksIncomplete': 0 });
  });
});
