import { countAssemblyResults } from '../../lib/toolkit/private/count-assembly-results';

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
    stacksRecursively: [stack],
    nestedAssemblies: [],
  };
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
