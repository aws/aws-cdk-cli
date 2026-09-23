import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createTestEvent } from './util';
import { CliIoHost } from '../../../../lib/cli/io-host';
import { FileTelemetrySink } from '../../../../lib/cli/telemetry/sink/file-sink';
import { Funnel } from '../../../../lib/cli/telemetry/sink/funnel';
import type { ITelemetrySink } from '../../../../lib/cli/telemetry/sink/sink-interface';

/**
 * A funnel only fans `emit` and `flush` out to the sinks it was given, so real sinks writing to real
 * files are what proves it: each one is independently observable, and a sink that was skipped leaves
 * an empty file behind.
 */
describe('Funnel', () => {
  let tempDir: string;
  let ioHost: CliIoHost;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-funnel-'));
    ioHost = CliIoHost.instance();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function fileSink(name: string): { sink: FileTelemetrySink; contents: () => any[] } {
    const logFilePath = path.join(tempDir, `${name}.json`);
    return {
      sink: new FileTelemetrySink({ ioHost, logFilePath }),
      contents: () => fs.readJSONSync(logFilePath),
    };
  }

  test('emit reaches every sink', async () => {
    const first = fileSink('first');
    const second = fileSink('second');
    const event = createTestEvent('INVOKE', { context: { foo: true } });

    await new Funnel({ sinks: [first.sink, second.sink] }).emit(event);

    expect(first.contents()).toEqual([event]);
    expect(second.contents()).toEqual([event]);
  });

  test('every event reaches every sink, in order', async () => {
    const first = fileSink('first');
    const second = fileSink('second');
    const funnel = new Funnel({ sinks: [first.sink, second.sink] });
    const one = createTestEvent('INVOKE', { foo: 'one' });
    const two = createTestEvent('SYNTH', { foo: 'two' });

    await funnel.emit(one);
    await funnel.emit(two);

    expect(first.contents()).toEqual([one, two]);
    expect(second.contents()).toEqual([one, two]);
  });

  test('flush reaches every sink', async () => {
    const flushed: string[] = [];
    const recording = (name: string): ITelemetrySink => ({
      emit: async () => undefined,
      flush: async () => {
        flushed.push(name);
      },
    });

    await new Funnel({ sinks: [recording('a'), recording('b'), recording('c')] }).flush();

    expect(flushed.sort()).toEqual(['a', 'b', 'c']);
  });

  test('a single sink is a valid funnel', async () => {
    const only = fileSink('only');
    const event = createTestEvent('INVOKE');

    const funnel = new Funnel({ sinks: [only.sink] });
    await funnel.emit(event);
    await funnel.flush();

    expect(only.contents()).toEqual([event]);
  });

  test('a funnel with no sinks is inert', async () => {
    const funnel = new Funnel({ sinks: [] });

    await expect(funnel.emit(createTestEvent('INVOKE'))).resolves.toBeUndefined();
    await expect(funnel.flush()).resolves.toBeUndefined();
  });

  test('a throwing sink surfaces, but the other sinks still received the event', async () => {
    // The funnel does not isolate failures -- it relies on sinks swallowing their own, which both
    // real sinks do. This pins the actual behaviour so a future sink that throws is not a surprise.
    const healthy = fileSink('healthy');
    const throwing: ITelemetrySink = {
      emit: async () => {
        throw new Error('sink is down');
      },
      flush: async () => undefined,
    };
    const event = createTestEvent('INVOKE');

    await expect(new Funnel({ sinks: [throwing, healthy.sink] }).emit(event)).rejects.toThrow('sink is down');

    expect(healthy.contents()).toEqual([event]);
  });

  test('throws when too many sinks are added', () => {
    const only = fileSink('only').sink;

    expect(() => new Funnel({ sinks: [only, only, only, only, only, only] }))
      .toThrow(/Funnel class supports a maximum of 5 parallel sinks, got 6 sinks./);
  });

  test('accepts the maximum number of sinks', () => {
    const only = fileSink('only').sink;

    expect(() => new Funnel({ sinks: [only, only, only, only, only] })).not.toThrow();
  });
});
