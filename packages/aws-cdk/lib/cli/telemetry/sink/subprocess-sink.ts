import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { IoHelper } from '../../../api-private';
import type { IIoHost } from '../../io-host';
import { cliRootDir } from '../../root-dir';
import type { TelemetryBatch } from '../post-telemetry';
import type { TelemetrySchema } from '../schema';
import type { TelemetrySenderConfig } from '../sender';
import type { ITelemetrySink } from './sink-interface';

/**
 * The bundled sender entry point, relative to this package's root.
 */
const SENDER_ENTRY_POINT = path.join('lib', 'cli', 'telemetry', 'sender-bundle.js');

/**
 * Stable prefix of the trace emitted once a batch has been handed to the sender.
 *
 * Integration tests match on this literal, so it must not change casually. Note that it reports a
 * successful hand-off, not a successful delivery -- by design nobody in this process ever learns
 * whether the POST succeeded.
 */
const DISPATCHED_TRACE = 'Telemetry dispatched';

/**
 * Properties for the subprocess telemetry sink.
 */
export interface SubprocessTelemetrySinkProps {
  /**
   * The external endpoint to hit
   */
  readonly endpoint: string;

  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;

  /**
   * Proxy the sender should route through, as configured by `--proxy` or the `proxy` setting.
   *
   * When absent, the sender resolves it from the inherited proxy environment variables, which is
   * the same behaviour `proxy-agent` gives the rest of the CLI.
   *
   * @default - resolved from the environment by the sender
   */
  readonly proxyUrl?: string;

  /**
   * Absolute path to the CA bundle to trust, as configured by `--ca-bundle-path` or `AWS_CA_BUNDLE`.
   *
   * @default - only the system trust store
   */
  readonly caBundlePath?: string;
}

/**
 * A telemetry sink that delivers events from a detached child process.
 *
 * The HTTP POST does not happen in this process. Events are written to a temporary file and handed
 * to a detached child that outlives us, so the CLI can exit immediately instead of waiting on the
 * network. Nothing here ever learns whether delivery succeeded, which is the point.
 *
 * Deliberately nothing checks first whether the network is reachable. Any such check is itself a
 * network call on the CLI's exit path, which is exactly what this sink exists to avoid. When the
 * machine is offline we simply spawn a child that fails and exits.
 */
export class SubprocessTelemetrySink implements ITelemetrySink {
  private events: TelemetrySchema[] = [];
  private endpoint: URL;
  private ioHelper: IoHelper;
  private senderPath?: string;
  private proxyUrl?: string;
  private caBundlePath?: string;

  public constructor(props: SubprocessTelemetrySinkProps) {
    this.endpoint = new URL(props.endpoint);

    if (!this.endpoint.hostname || !this.endpoint.pathname) {
      throw new ToolkitError('MalformedEndpoint', `Telemetry Endpoint malformed. Received hostname: ${this.endpoint.hostname}, pathname: ${this.endpoint.pathname}`);
    }

    this.ioHelper = IoHelper.fromActionAwareIoHost(props.ioHost);
    this.senderPath = resolveSenderPath();
    this.proxyUrl = props.proxyUrl;
    this.caBundlePath = props.caBundlePath;

    // Batch events every 30 seconds
    setInterval(() => this.flush(), 30000).unref();
  }

  /**
   * Add an event to the collection.
   */
  public async emit(event: TelemetrySchema): Promise<void> {
    try {
      this.events.push(event);
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHelper.defaults.trace(`Failed to add telemetry event: ${e.message}`);
    }
  }

  public async flush(): Promise<void> {
    try {
      if (this.events.length === 0) {
        return;
      }

      const res = await this.dispatch(this.endpoint, { events: this.events });

      // Clear the events array after successful output
      if (res) {
        this.events = [];
      }
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHelper.defaults.trace(`Failed to send telemetry event: ${e.message}`);
    }
  }

  /**
   * Hand the batch to a detached sender process.
   *
   * Returns true if the batch was handed off and should therefore be cleared, false if it is worth
   * retrying on the next flush.
   */
  private async dispatch(url: URL, body: TelemetryBatch): Promise<boolean> {
    if (!this.senderPath) {
      await this.ioHelper.defaults.trace('Telemetry not sent: unable to locate the telemetry sender');
      return false;
    }

    const config: TelemetrySenderConfig = {
      endpoint: url.href,
      body,
      proxyUrl: this.proxyUrl,
      caBundlePath: this.caBundlePath,
    };
    const payload = JSON.stringify(config);

    // Handed over as a file rather than on the child's stdin. Writing to stdin means the parent
    // blocks once the payload outgrows the OS pipe buffer, waiting for a child it is trying not to
    // wait for; a file write does not, whatever the size.
    const payloadPath = path.join(os.tmpdir(), `cdk-telemetry-${process.pid}-${randomUUID()}.json`);

    try {
      fs.writeFileSync(payloadPath, payload, { encoding: 'utf-8', mode: 0o600 });

      const child = spawn(process.execPath, [this.senderPath, payloadPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
        // Do not hold a reference to the user's working directory; they may want to delete it.
        cwd: os.tmpdir(),
      });

      // The child is on its own from here; a spawn failure must not surface anywhere. This fires
      // after the CLI may already have exited, so it cannot go through the IoHost -- see
      // `debugTrace`.
      child.on('error', (e: Error) => {
        debugTrace(`failed to spawn sender: ${e.message}`);
        tryUnlink(payloadPath);
      });

      child.unref();

      await this.ioHelper.defaults.trace(`${DISPATCHED_TRACE} (pid ${child.pid}, ${Buffer.byteLength(payload)} bytes)`);
      return true;
    } catch (e: any) {
      tryUnlink(payloadPath);
      await this.ioHelper.defaults.trace(`Telemetry Error: spawning sender for POST ${url.hostname}${url.pathname} failed: ${e.message}`);
      return false;
    }
  }
}

/**
 * Locate the bundled sender entry point inside this package.
 *
 * Resolved by walking up to the package root, which works both from `lib/` in source and from the
 * released bundle. `process.argv[1]` is deliberately NOT used: depending on how the CLI was started
 * it is the `node_modules/.bin/cdk` symlink, the `cdk` alias package's wrapper, or -- when the CLI
 * is driven programmatically -- somebody else's script entirely.
 *
 * Returns undefined if the entry point is not on disk, in which case telemetry is skipped.
 */
function resolveSenderPath(): string | undefined {
  const root = cliRootDir(false);
  if (!root) {
    return undefined;
  }

  const senderPath = path.join(root, SENDER_ENTRY_POINT);
  return fs.existsSync(senderPath) ? senderPath : undefined;
}

function tryUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Nothing useful to do about it; the OS cleans its own temp directory.
  }
}

/**
 * Diagnostics for failures that surface after the CLI may already have exited.
 *
 * The child's `error` event fires asynchronously, potentially once the IoHost is gone and the
 * process is on its way out, so it cannot be reported through the normal trace channel. Written
 * synchronously to fd 2 for the same reason the sender does it, and gated behind the same variable
 * so it is silent unless somebody is deliberately debugging telemetry delivery.
 */
function debugTrace(message: string): void {
  if (process.env.CDK_TELEMETRY_SENDER_DEBUG !== '1') {
    return;
  }
  try {
    fs.writeSync(2, `[cdk-telemetry-dispatch] ${message}\n`);
  } catch {
    // Diagnostics must never be the reason anything fails.
  }
}
