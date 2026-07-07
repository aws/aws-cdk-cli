import * as cdkExplorer from '@aws-cdk/cdk-explorer';
import { lsp } from '../../lib/commands/lsp';

jest.mock('@aws-cdk/cdk-explorer', () => ({
  startServer: jest.fn(),
}));

describe('lsp command', () => {
  const startServer = cdkExplorer.startServer as jest.Mock;

  afterEach(() => {
    startServer.mockClear();
  });

  test('starts the language server on stdio and exits 0 when stdin closes', async () => {
    const resultPromise = lsp();

    // The server is started over the process stdio streams (the LSP transport).
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(startServer).toHaveBeenCalledWith({
      readable: process.stdin,
      writable: process.stdout,
    });

    // Simulate the LSP client closing the stdio channel.
    process.stdin.emit('end');

    await expect(resultPromise).resolves.toBe(0);
  });
});
