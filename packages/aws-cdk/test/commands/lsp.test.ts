import * as cdkExplorer from '@aws-cdk/cdk-explorer';
import { lsp } from '../../lib/commands/lsp';

jest.mock('@aws-cdk/cdk-explorer', () => ({
  startLspServer: jest.fn(),
}));

describe('lsp command', () => {
  const startLspServer = cdkExplorer.startLspServer as jest.Mock;

  afterEach(() => {
    startLspServer.mockClear();
  });

  test('starts the language server on stdio and exits 0 when stdin closes', async () => {
    const resultPromise = lsp();

    // The command delegates to the fully-wired stdio entrypoint.
    expect(startLspServer).toHaveBeenCalledTimes(1);

    // Simulate the LSP client closing the stdio channel.
    process.stdin.emit('end');

    await expect(resultPromise).resolves.toBe(0);
  });
});
