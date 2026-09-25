import * as os from 'os';
import * as path from 'path';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { SynthesisMessageLevel } from '@aws-cdk/cloud-assembly-api';
import * as fs from 'fs-extra';
import { countAssemblyResults, offlineValidationSummary } from '../../lib/toolkit/private/count-assembly-results';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-assembly-results-'));
});

afterEach(() => {
  fs.removeSync(dir);
});

// Minimal span that records incCounter calls; only the surface
// countAssemblyResults touches is implemented.
function fakeSpan() {
  const counters: Array<{ name: string; delta?: number }> = [];
  return {
    counters,
    span: {
      incCounter: (name: string, delta?: number) => {
        counters.push({ name, delta });
      },
    } as any,
  };
}

// Minimal CloudAssembly stand-in. `metadata` is deliberately undefined on the
// stack to reproduce the crash: countAssemblyResults used to call
// Object.values(stack.metadata) with no null guard.
function assemblyWithStack(stack: any): any {
  return {
    directory: dir,
    stacksRecursively: [stack],
    nestedAssemblies: [],
  };
}

function assembly(messageLevels: SynthesisMessageLevel[]): cxapi.CloudAssembly {
  return {
    directory: dir,
    stacksRecursively: [{
      messages: messageLevels.map((level) => ({ level, id: 'some-id', entry: { type: 'aws:cdk:error', data: 'msg' } })),
    }],
  } as any;
}

function writeReport(pluginReports: Array<{ pluginName?: string; conclusion: 'success' | 'failure'; severities?: string[] }>) {
  fs.writeJSONSync(path.join(dir, 'validation-report.json'), {
    version: '1.0.0',
    pluginReports: pluginReports.map((r, i) => ({
      pluginName: r.pluginName ?? `Plugin${i}`,
      conclusion: r.conclusion,
      violations: (r.severities ?? []).map((severity) => ({
        ruleName: 'some-rule',
        description: 'some description',
        severity,
        violatingConstructs: [],
      })),
    })),
  });
}

describe('countAssemblyResults', () => {
  test('does not throw when a stack has no metadata', () => {
    const { span } = fakeSpan();
    const stack = {
      messages: [],
      metadata: undefined, // the crashing input
    };

    expect(() => countAssemblyResults(span, assemblyWithStack(stack))).not.toThrow();
  });

  test('still counts annotation error codes when metadata is present', () => {
    const { span, counters } = fakeSpan();
    const stack = {
      messages: [],
      metadata: {
        '/some/path': [{ type: 'aws:cdk:error-code', data: 'MY_ERROR' }],
      },
    };

    countAssemblyResults(span, assemblyWithStack(stack));

    expect(counters).toContainEqual({ name: 'errorAnn:MY_ERROR', delta: undefined });
  });
});

describe('offlineValidationSummary', () => {
  describe('wouldFailDeploy', () => {
    test('false when there are no error annotations and no validation report', () => {
      expect(offlineValidationSummary(assembly([SynthesisMessageLevel.WARNING])).wouldFailDeploy).toBe(false);
    });

    test('true when a stack has an error-level annotation', () => {
      expect(offlineValidationSummary(assembly([SynthesisMessageLevel.ERROR])).wouldFailDeploy).toBe(true);
    });

    test('true when the validation report has a failing plugin report', () => {
      writeReport([{ conclusion: 'success' }, { conclusion: 'failure' }]);

      expect(offlineValidationSummary(assembly([])).wouldFailDeploy).toBe(true);
    });

    test('false when the validation report has only successful plugin reports', () => {
      writeReport([{ conclusion: 'success' }]);

      expect(offlineValidationSummary(assembly([])).wouldFailDeploy).toBe(false);
    });
  });

  describe('offlineValidationWarnings', () => {
    test('zero when there is no validation report', () => {
      expect(offlineValidationSummary(assembly([])).offlineValidationWarnings).toBe(0);
    });

    test('counts warning-severity violations across policy plugin reports', () => {
      writeReport([
        { conclusion: 'failure', severities: ['error', 'warning', 'warning'] },
        { conclusion: 'success', severities: ['warning', 'info'] },
      ]);

      expect(offlineValidationSummary(assembly([])).offlineValidationWarnings).toBe(3);
    });

    test('excludes construct annotation warnings (counted by the warnings counter)', () => {
      writeReport([
        { pluginName: 'Construct Annotations', conclusion: 'success', severities: ['warning', 'warning'] },
        { pluginName: 'SomePolicyPlugin', conclusion: 'success', severities: ['warning'] },
      ]);

      expect(offlineValidationSummary(assembly([])).offlineValidationWarnings).toBe(1);
    });
  });
});
