import { TextDocumentSyncKind } from 'vscode-languageserver/node';
import { createLspHandlers } from '../../lib/lsp/server';

describe('createLspHandlers', () => {
  function init(handlers: ReturnType<typeof createLspHandlers>, applicationDir = '/tmp/test-project') {
    handlers.onInitialize({
      processId: null,
      capabilities: {},
      rootUri: null,
      initializationOptions: { applicationDir },
    });
    handlers.onInitialized();
  }

  test('initialize advertises didSave-only textDocument sync', () => {
    const result = createLspHandlers().onInitialize({
      processId: null,
      capabilities: {},
      rootUri: null,
      initializationOptions: {},
    });

    expect(result).toEqual({
      capabilities: {
        textDocumentSync: {
          openClose: false,
          change: TextDocumentSyncKind.None,
          save: { includeText: false },
        },
      },
    });
  });

  test('didSave triggers onSynthRequest with the application dir', () => {
    const requests: string[] = [];
    const handlers = createLspHandlers({ onSynthRequest: (d) => requests.push(d) });
    init(handlers);

    handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    expect(requests).toEqual(['/tmp/test-project']);
  });

  test('didSave is filtered for files matching the watch-exclude defaults', () => {
    const requests: string[] = [];
    const handlers = createLspHandlers({ onSynthRequest: (d) => requests.push(d) });
    init(handlers);

    handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/node_modules/foo/index.ts' },
    });
    handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/cdk.out/tree.json' },
    });

    expect(requests).toEqual([]);
  });

  test('didSave is a no-op when onSynthRequest is not provided', () => {
    const handlers = createLspHandlers();
    init(handlers);

    expect(() =>
      handlers.onDidSaveTextDocument({
        textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
      }),
    ).not.toThrow();
  });

  test('didSave is ignored after shutdown', () => {
    const requests: string[] = [];
    const handlers = createLspHandlers({ onSynthRequest: (d) => requests.push(d) });
    init(handlers);

    handlers.onShutdown();
    handlers.onDidSaveTextDocument({
      textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
    });

    expect(requests).toEqual([]);
  });

  test('onSynthRequest errors are caught and surfaced via the logger', () => {
    const errors: string[] = [];
    const handlers = createLspHandlers({
      onSynthRequest: () => {
        throw new Error('synth failed');
      },
      logger: { error: (m) => errors.push(m) },
    });
    init(handlers);

    expect(() =>
      handlers.onDidSaveTextDocument({
        textDocument: { uri: 'file:///tmp/test-project/lib/my-stack.ts' },
      }),
    ).not.toThrow();
    expect(errors).toEqual(['Synth request failed: synth failed']);
  });
});
