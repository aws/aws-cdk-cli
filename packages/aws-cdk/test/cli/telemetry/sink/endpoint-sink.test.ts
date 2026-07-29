import { spawn } from 'node:child_process';
import * as os from 'node:os';
import { createTestEvent } from './util';
import { IoHelper } from '../../../../lib/api-private';
import { CliIoHost } from '../../../../lib/cli/io-host';
import { EndpointTelemetrySink } from '../../../../lib/cli/telemetry/sink/endpoint-sink';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const BIN_CDK = '/fake/pkg/bin/cdk';

interface MockChild {
  pid: number;
  on: jest.Mock;
  unref: jest.Mock;
  stdin: { on: jest.Mock; end: jest.Mock };
}

describe('EndpointTelemetrySink', () => {
  let ioHost: CliIoHost;
  let child: MockChild;

  beforeEach(() => {
    jest.resetAllMocks();

    child = {
      pid: 4242,
      on: jest.fn(),
      unref: jest.fn(),
      stdin: { on: jest.fn(), end: jest.fn() },
    };
    (spawn as jest.Mock).mockReturnValue(child);

    ioHost = CliIoHost.instance();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function sink(props: Partial<ConstructorParameters<typeof EndpointTelemetrySink>[0]> = {}) {
    return new EndpointTelemetrySink({
      endpoint: 'https://example.com/telemetry',
      ioHost,
      binCdkPath: BIN_CDK,
      ...props,
    });
  }

  /**
   * The JSON that was piped to the detached sender on the Nth spawn.
   */
  function pipedPayload(nth = 0) {
    return JSON.parse(child.stdin.end.mock.calls[nth][0]);
  }

  describe('dispatching', () => {
    test('does not spawn anything at construction time', () => {
      // Constructing a sink must be free of side effects: `startTelemetry` builds one against the
      // real production endpoint even in unit tests.
      sink();

      expect(spawn).not.toHaveBeenCalled();
    });

    test('does not spawn when there are no events', async () => {
      await sink().flush();

      expect(spawn).not.toHaveBeenCalled();
    });

    test('spawns a detached sender and pipes the payload to it', async () => {
      const testEvent = createTestEvent('INVOKE', { foo: 'bar' });
      const client = sink();

      await client.emit(testEvent);
      await client.flush();

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(process.execPath, [BIN_CDK], expect.objectContaining({
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
        shell: false,
        cwd: os.tmpdir(),
      }));

      expect(pipedPayload()).toEqual({
        endpoint: 'https://example.com/telemetry',
        body: { events: [testEvent] },
        timeoutMs: 500,
      });
    });

    test('marks the child as the sender and lets it outlive us', async () => {
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      const options = (spawn as jest.Mock).mock.calls[0][2];
      expect(options.env.CDK_TELEMETRY_SENDER).toBe('1');
      expect(child.unref).toHaveBeenCalledTimes(1);
      // A spawn failure must not surface as an unhandled 'error' event.
      expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(child.stdin.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('forwards the proxy and CA configuration the child cannot rediscover', async () => {
      const client = sink({ proxyUrl: 'http://corp:8080', caCert: '-----BEGIN CERTIFICATE-----\nxx\n' });
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      expect(pipedPayload()).toMatchObject({
        proxyUrl: 'http://corp:8080',
        ca: '-----BEGIN CERTIFICATE-----\nxx\n',
      });
    });

    test('batches multiple events into a single sender', async () => {
      const testEvent1 = createTestEvent('INVOKE', { foo: 'bar' });
      const testEvent2 = createTestEvent('INVOKE', { foo: 'bazoo' });
      const client = sink();

      await client.emit(testEvent1);
      await client.emit(testEvent2);
      await client.flush();

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(pipedPayload().body).toEqual({ events: [testEvent1, testEvent2] });
    });

    test('successful dispatch clears the events cache', async () => {
      const testEvent1 = createTestEvent('INVOKE', { foo: 'bar' });
      const testEvent2 = createTestEvent('INVOKE', { foo: 'bazoo' });
      const client = sink();

      await client.emit(testEvent1);
      await client.flush();
      await client.emit(testEvent2);
      await client.flush();

      expect(spawn).toHaveBeenCalledTimes(2);
      expect(pipedPayload(0).body).toEqual({ events: [testEvent1] });
      expect(pipedPayload(1).body).toEqual({ events: [testEvent2] });
    });
  });

  describe('back-pressure guard', () => {
    test('drops a payload too large to hand over without blocking our own exit', async () => {
      const traceSpy = jest.fn();
      jest.spyOn(IoHelper, 'fromActionAwareIoHost').mockReturnValue({ defaults: { trace: traceSpy } } as any);

      const client = sink();
      // ~200KB of events, comfortably past the 64KB guard.
      for (let i = 0; i < 200; i++) {
        await client.emit(createTestEvent('INVOKE', { padding: 'x'.repeat(1000) }));
      }

      await client.flush();

      expect(spawn).not.toHaveBeenCalled();
      expect(traceSpy).toHaveBeenCalledWith(expect.stringContaining('Telemetry dropped'));

      // The batch is undeliverable, so it must be discarded rather than grown forever.
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(pipedPayload().body.events).toHaveLength(1);
    });

    test('a normal batch is nowhere near the guard', async () => {
      const client = sink();
      for (let i = 0; i < 3; i++) {
        await client.emit(createTestEvent('INVOKE'));
      }

      await client.flush();

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(Buffer.byteLength(child.stdin.end.mock.calls[0][0])).toBeLessThan(65_536);
    });
  });

  describe('failure handling', () => {
    test('dispatches without first probing the network', async () => {
      // Any reachability probe would itself be a network call on the CLI's exit path, which is what
      // this sink exists to avoid. Offline machines just spawn a child that fails and exits.
      const client = sink();
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      expect(spawn).toHaveBeenCalledTimes(1);
    });

    test('skips when the CLI entrypoint could not be located', async () => {
      const traceSpy = jest.fn();
      jest.spyOn(IoHelper, 'fromActionAwareIoHost').mockReturnValue({ defaults: { trace: traceSpy } } as any);

      const client = sink({ binCdkPath: undefined });
      await client.emit(createTestEvent('INVOKE'));
      await client.flush();

      expect(spawn).not.toHaveBeenCalled();
      expect(traceSpy).toHaveBeenCalledWith(expect.stringContaining('unable to locate the CLI entrypoint'));
    });

    test('swallows a spawn failure, traces it, and retains the events', async () => {
      const traceSpy = jest.fn();
      jest.spyOn(IoHelper, 'fromActionAwareIoHost').mockReturnValue({ defaults: { trace: traceSpy } } as any);
      (spawn as jest.Mock).mockImplementation(() => {
        throw new Error('EMFILE');
      });

      const client = sink();
      await client.emit(createTestEvent('INVOKE'));

      await expect(client.flush()).resolves.not.toThrow();
      expect(traceSpy).toHaveBeenCalledWith(
        expect.stringContaining('Telemetry Error: spawning sender for POST example.com/telemetry'),
      );

      // Retained for a retry.
      (spawn as jest.Mock).mockReturnValue(child);
      await client.flush();
      expect(child.stdin.end).toHaveBeenCalledTimes(1);
    });

    test('rejects a malformed endpoint at construction', () => {
      expect(() => sink({ endpoint: 'not-a-url' })).toThrow();
    });
  });

  test('reports a successful hand-off on the trace channel', async () => {
    const traceSpy = jest.fn();
    jest.spyOn(IoHelper, 'fromActionAwareIoHost').mockReturnValue({ defaults: { trace: traceSpy } } as any);

    const client = sink();
    await client.emit(createTestEvent('INVOKE'));
    await client.flush();

    // Integration tests match on the 'Telemetry dispatched' prefix, so it must survive refactors.
    expect(traceSpy).toHaveBeenCalledWith(expect.stringContaining('Telemetry dispatched'));
    expect(traceSpy).toHaveBeenCalledWith(expect.stringMatching(/^Telemetry dispatched \(pid 4242, \d+ bytes\)$/));
  });

  test('flush is called every 30 seconds', async () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const client = sink();
    const flushSpy = jest.spyOn(client, 'flush');

    jest.advanceTimersByTime(30000);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    expect(flushSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30000);
    expect(flushSpy).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
    setIntervalSpy.mockRestore();
  });
});
