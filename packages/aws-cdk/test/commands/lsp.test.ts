import * as cdkExplorer from '@aws-cdk/cdk-explorer';
import { lsp } from '../../lib/commands/lsp';

jest.mock('@aws-cdk/cdk-explorer', () => ({
  startLspServer: jest.fn(),
  cdkLspManifest: jest.fn(() => ({ protocol: 1, features: ['hover'], commands: ['cdk.explorer.synthNow'] })),
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

  test('--features prints the manifest as JSON and exits without starting the server', async () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await expect(lsp({ features: true })).resolves.toBe(0);
      expect(startLspServer).not.toHaveBeenCalled();
      expect(write).toHaveBeenCalledTimes(1);
      const printed = (write.mock.calls[0][0] as string).trim();
      expect(JSON.parse(printed)).toEqual({ protocol: 1, features: ['hover'], commands: ['cdk.explorer.synthNow'] });
    } finally {
      write.mockRestore();
    }
  });
});
