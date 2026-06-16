import type { IoMessage, IoRequest } from '@aws-cdk/toolkit-lib';
import type { RemoteConsole } from 'vscode-languageserver/node';
import { LspIoHost } from '../../lib/lsp/io-host';

function makeConsole(): jest.Mocked<Pick<RemoteConsole, 'error' | 'warn' | 'info'>> {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
}

function msg(level: string, message: string): IoMessage<unknown> {
  return { level, message, action: 'test', code: 'TEST_001', data: undefined, time: new Date() } as unknown as IoMessage<unknown>;
}

describe('LspIoHost', () => {
  test('routes error level to console.error', async () => {
    const console = makeConsole();
    const host = new LspIoHost(console as unknown as RemoteConsole);
    await host.notify(msg('error', 'something broke'));
    expect(console.error).toHaveBeenCalledWith('something broke');
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  test('routes warn level to console.warn', async () => {
    const console = makeConsole();
    const host = new LspIoHost(console as unknown as RemoteConsole);
    await host.notify(msg('warn', 'a warning'));
    expect(console.warn).toHaveBeenCalledWith('a warning');
  });

  test('routes info and default levels to console.info', async () => {
    const console = makeConsole();
    const host = new LspIoHost(console as unknown as RemoteConsole);
    await host.notify(msg('info', 'an info'));
    await host.notify(msg('result', 'a result'));
    expect(console.info).toHaveBeenCalledTimes(2);
  });

  test('suppresses debug and trace levels', async () => {
    const console = makeConsole();
    const host = new LspIoHost(console as unknown as RemoteConsole);
    await host.notify(msg('debug', 'verbose'));
    await host.notify(msg('trace', 'very verbose'));
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  test('requestResponse returns defaultResponse without blocking', async () => {
    const console = makeConsole();
    const host = new LspIoHost(console as unknown as RemoteConsole);
    const request = {
      ...msg('info', 'MFA token?'),
      defaultResponse: 'default-token',
    } as unknown as IoRequest<unknown, string>;

    const result = await host.requestResponse(request);

    expect(result).toBe('default-token');
  });
});
