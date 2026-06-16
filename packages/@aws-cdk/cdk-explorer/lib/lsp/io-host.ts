import type { IIoHost, IoMessage, IoRequest } from '@aws-cdk/toolkit-lib';
import type { RemoteConsole } from 'vscode-languageserver/node';

/**
 * IoHost for the LSP. Routes Toolkit messages into the editor's Output
 * channel via the LSP connection's console.
 *
 * The LSP cannot prompt the user synchronously through `connection.console`,
 * so `requestResponse` returns each message's `defaultResponse`. This is
 * acceptable for `synth`, which has no interactive prompts.
 */
export class LspIoHost implements IIoHost {
  public constructor(private readonly console: RemoteConsole) {}

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    switch (msg.level) {
      case 'error':
        this.console.error(msg.message);
        break;
      case 'warn':
        this.console.warn(msg.message);
        break;
      case 'debug':
      case 'trace':
        // Suppress noisy levels; keeps the Output panel readable.
        break;
      default:
        this.console.info(msg.message);
    }
  }

  public async requestResponse<T>(msg: IoRequest<unknown, T>): Promise<T> {
    await this.notify(msg);
    return msg.defaultResponse;
  }
}
