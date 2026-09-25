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
  test('counts the total number of online violations', () => {
    countOnlineValidationResults(span, [
      report('CloudFormation', 'failure', ['fatal', 'fatal']),
    ]);

    expect(counters).toEqual({ onlineViolations: 2 });
  });

  test('no online reports produce a zero counter', () => {
    countOnlineValidationResults(span, []);

    expect(counters).toEqual({ onlineViolations: 0 });
  });

  test('undefined online reports produce a zero counter', () => {
    countOnlineValidationResults(span, undefined);

    expect(counters).toEqual({ onlineViolations: 0 });
  });
});
