import type { IIoHost, IoMessage, IoRequest } from '@aws-cdk/toolkit-lib';
import type { RemoteConsole } from 'vscode-languageserver/node';

/**
 * IoHost for the LSP. Routes Toolkit messages into the editor's Output
 * channel via the LSP connection's console.
 *
 * We do NOT reuse `NonInteractiveIoHost` from toolkit-lib even though its
 * `requestResponse` is identical: that class writes to `process.stdout` /
 * `process.stderr`, which are the JSON-RPC transport for this process.
 * Writing Toolkit output there would corrupt the protocol stream.
 *
 * The LSP cannot prompt the user synchronously through `connection.console`,
 * so `requestResponse` returns each message's `defaultResponse`. For synth,
 * the only reachable interactive prompt is an MFA token (when the app has
 * context lookups, no cached `cdk.context.json`, and an MFA-protected profile).
 * Returning the default causes an auth failure, surfaced as `app-failure` with
 * a clear message. All other prompts are on deploy/destroy paths we don't call.
 */
export class LspIoHost implements IIoHost {
  public constructor(private readonly console: RemoteConsole) {
  }

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
