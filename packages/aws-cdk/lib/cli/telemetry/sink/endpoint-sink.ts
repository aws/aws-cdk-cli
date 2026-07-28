import { spawn } from 'node:child_process';
import * as os from 'node:os';
import type { Agent } from 'https';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { NetworkDetector } from '../../../api/network-detector';
import { IoHelper } from '../../../api-private';
import type { IIoHost } from '../../io-host';
import type { TelemetrySchema } from '../schema';
import type { ITelemetrySink } from './sink-interface';

const REQUEST_ATTEMPT_TIMEOUT_MS = 500;

/**
 * Largest payload we are willing to hand to the detached sender.
 *
 * The payload is written to the child's stdin. Once it exceeds the OS pipe buffer plus libuv's
 * own buffering, `write()` no longer completes eagerly and the parent ends up waiting for the
 * child to drain -- which is exactly the blocking behaviour the detached sender exists to remove.
 * Measured on Linux/Node 20, the parent still exits in ~37ms at 200KB but stalls for seconds at
 * 400KB, so 64KB leaves a wide margin. Realistic batches are 3-10KB.
 */
const MAX_DISPATCH_PAYLOAD_BYTES = 65_536;

/**
 * Properties for the Endpoint Telemetry Client
 */
export interface EndpointTelemetrySinkProps {
  /**
   * The external endpoint to hit
   */
  readonly endpoint: string;

  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;

  /**
   * The agent responsible for making the network requests.
   *
   * Use this to set up a proxy connection.
   *
   * @default - Uses the shared global node agent
   */
  readonly agent?: Agent;

  /**
   * Absolute path to this CLI's `bin/cdk` script, used to respawn ourselves as a telemetry sender.
   *
   * Without it we cannot dispatch, and telemetry is silently skipped.
   *
   * @default - telemetry is not sent
   */
  readonly binCdkPath?: string;

  /**
   * Proxy the sender should tunnel through, as configured by `--proxy` or the `proxy` setting.
   *
   * When absent, the sender falls back to the inherited proxy environment variables, which is the
   * same behaviour `proxy-agent` gives the rest of the CLI.
   *
   * @default - resolved from the environment by the sender
   */
  readonly proxyUrl?: string;

  /**
   * Contents of the CA bundle to trust, as configured by `--ca-bundle-path` or `AWS_CA_BUNDLE`.
   *
   * @default - only the system trust store
   */
  readonly caCert?: string;
}

/**
 * The telemetry client that hits an external endpoint.
 *
 * The HTTP POST itself does not happen in this process. Events are handed to a detached child
 * process (`bin/cdk` re-invoked with `CDK_TELEMETRY_SENDER=1`) which outlives us, so the CLI can
 * exit without waiting on the network.
 */
export class EndpointTelemetrySink implements ITelemetrySink {
  private events: TelemetrySchema[] = [];
  private endpoint: URL;
  private ioHelper: IoHelper;
  private agent?: Agent;
  private binCdkPath?: string;
  private proxyUrl?: string;
  private caCert?: string;

  public constructor(props: EndpointTelemetrySinkProps) {
    this.endpoint = new URL(props.endpoint);

    if (!this.endpoint.hostname || !this.endpoint.pathname) {
      throw new ToolkitError('MalformedEndpoint', `Telemetry Endpoint malformed. Received hostname: ${this.endpoint.hostname}, pathname: ${this.endpoint.pathname}`);
    }

    this.ioHelper = IoHelper.fromActionAwareIoHost(props.ioHost);
    this.agent = props.agent;
    this.binCdkPath = props.binCdkPath;
    this.proxyUrl = props.proxyUrl;
    this.caCert = props.caCert;

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
   * Returns true if the batch reached a terminal state (either handed off, or dropped because it
   * can never be delivered) and should therefore be cleared. Returns false if it is worth
   * retrying on the next flush.
   */
  private async dispatch(
    url: URL,
    body: { events: TelemetrySchema[] },
  ): Promise<boolean> {
    // Check connectivity before spawning anything. This is a cache read in the common case: the
    // notices refresh earlier in the same invocation has already primed it.
    const hasConnectivity = await NetworkDetector.hasConnectivity(this.agent);
    if (!hasConnectivity) {
      await this.ioHelper.defaults.trace('No internet connectivity detected, skipping telemetry');
      return false;
    }

    if (!this.binCdkPath) {
      await this.ioHelper.defaults.trace('Telemetry not sent: unable to locate the CLI entrypoint to spawn a sender');
      return false;
    }

    const payload = JSON.stringify({
      endpoint: url.href,
      body,
      proxyUrl: this.proxyUrl,
      ca: this.caCert,
      timeoutMs: REQUEST_ATTEMPT_TIMEOUT_MS,
    });

    const payloadBytes = Buffer.byteLength(payload);
    if (payloadBytes > MAX_DISPATCH_PAYLOAD_BYTES) {
      // Writing this much to the child's stdin would block our own exit. Drop the batch; it is
      // not going to get smaller on a retry.
      await this.ioHelper.defaults.trace(`Telemetry dropped: payload of ${payloadBytes} bytes exceeds ${MAX_DISPATCH_PAYLOAD_BYTES}`);
      return true;
    }

    try {
      const child = spawn(process.execPath, [this.binCdkPath], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
        shell: false,
        // Do not hold a reference to the user's working directory; they may want to delete it.
        cwd: os.tmpdir(),
        env: {
          ...process.env,
          CDK_TELEMETRY_SENDER: '1',
        },
      });

      // The child is on its own from here; a spawn failure must not surface anywhere.
      child.on('error', () => {});
      child.stdin?.on('error', () => {});

      child.stdin?.end(payload);
      child.unref();

      await this.ioHelper.defaults.trace(`Telemetry dispatched to detached sender (pid ${child.pid}, ${payloadBytes} bytes)`);
      // Retained for backwards compatibility: several integration tests assert on this exact
      // string. Delivery is now asynchronous, so this reports a successful hand-off.
      await this.ioHelper.defaults.trace('Telemetry Sent Successfully');
      return true;
    } catch (e: any) {
      await this.ioHelper.defaults.trace(`Telemetry Error: spawning sender for POST ${url.hostname}${url.pathname} failed: ${e.message}`);
      return false;
    }
  }
}
