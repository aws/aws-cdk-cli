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
 * Reports a successful hand-off, NOT a successful delivery. Integration tests match on this literal.
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
   * @default - resolved from the environment by the sender, as `proxy-agent` does for the rest of the CLI
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
 * Events are written to a temporary file and handed to a child that outlives us, so the CLI can exit
 * immediately instead of waiting on the network. Nothing here ever learns whether delivery succeeded.
 *
 * Deliberately does not check connectivity first: that check would itself be a network call on the
 * exit path, which is what this sink exists to avoid.
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
    this.events.push(event);
  }

  /**
   * Hand whatever has accumulated to a detached sender.
   *
   * Clears the batch either way: delivery is one-shot, the process that would retry has usually
   * exited, and retaining the events would just re-report the failure and regrow the batch every 30s.
   * This is the single place delivery failures are handled; `dispatch` reports them by throwing.
   */
  public async flush(): Promise<void> {
    if (this.events.length === 0) {
      return;
    }

    const batch = this.events;
    this.events = [];

    try {
      await this.dispatch(this.endpoint, { events: batch });
    } catch (e: any) {
      await this.ioHelper.defaults.trace(`Failed to send telemetry event: ${e.message}`);
    }
  }

  /**
   * Hand the batch to a detached sender process.
   *
   * Throws if the batch could not be handed over.
   */
  private async dispatch(url: URL, body: TelemetryBatch): Promise<void> {
    if (!this.senderPath) {
      throw new ToolkitError('SenderNotFound', `Unable to locate the telemetry sender at ${SENDER_ENTRY_POINT}`);
    }

    const config: TelemetrySenderConfig = {
      endpoint: url.href,
      body,
      proxyUrl: this.proxyUrl,
      caBundlePath: this.caBundlePath,
    };
    const payload = JSON.stringify(config);

    // A file rather than the child's stdin: writing to stdin blocks the parent once the payload
    // outgrows the OS pipe buffer, which is the wait this sink exists to avoid.
    const payloadPath = path.join(os.tmpdir(), `cdk-telemetry-${process.pid}-${randomUUID()}.json`);

    try {
      fs.writeFileSync(payloadPath, payload, { encoding: 'utf-8', mode: 0o600 });

      const child = spawn(process.execPath, [this.senderPath, payloadPath], {
        detached: true,
        // Pass the child's diagnostics through only when asked; otherwise nothing reads them.
        stdio: senderDebugEnabled() ? ['ignore', 'ignore', 'inherit'] : 'ignore',
        windowsHide: true,
        shell: false,
        // Do not hold a reference to the user's working directory; they may want to delete it.
        cwd: os.tmpdir(),
      });

      // Fires after the CLI may already have exited, so it cannot go through the IoHost.
      child.on('error', (e: Error) => {
        debugTrace(`failed to spawn sender: ${e.message}`);
        tryUnlink(payloadPath);
      });

      child.unref();

      await this.ioHelper.defaults.trace(`${DISPATCHED_TRACE} (pid ${child.pid}, ${Buffer.byteLength(payload)} bytes)`);
    } catch (e: any) {
      tryUnlink(payloadPath);
      throw new ToolkitError('DispatchFailed', `Spawning a sender for POST ${url.hostname}${url.pathname} failed: ${e.message}`);
    }
  }
}

/**
 * Locate the bundled sender entry point inside this package.
 *
 * Walks up to the package root, which works both from `lib/` in source and from the released bundle.
 * `process.argv[1]` is deliberately NOT used: it may be the `.bin/cdk` symlink, the `cdk` alias
 * package's wrapper, or -- when the CLI is driven programmatically -- somebody else's script.
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
 * Whether the user asked to see the sender's diagnostics.
 */
function senderDebugEnabled(): boolean {
  return process.env.CDK_TELEMETRY_SENDER_DEBUG === '1';
}

/**
 * Diagnostics for failures that surface after the CLI may already have exited, so they cannot go
 * through the IoHost. Gated behind the same variable as the sender's own traces.
 */
function debugTrace(message: string): void {
  if (!senderDebugEnabled()) {
    return;
  }
  try {
    fs.writeSync(2, `[cdk-telemetry-dispatch] ${message}\n`);
  } catch {
    // Diagnostics must never be the reason anything fails.
  }
}
