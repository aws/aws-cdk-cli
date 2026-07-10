import { IoHostRecorder } from './io-recorder';
import { asIoHelper, IO } from '../../lib/api-private';
import { CliIoHost } from '../../lib/cli/io-host';

describe('IoHostRecorder', () => {
  test('captures messages of every level, independent of the host log level', async () => {
    // The host is configured to only *print* `info` and above. The recorder must
    // still capture trace/debug, because it records at the notify boundary which
    // is upstream of the host's `isMessageRelevantForLevel` filtering.
    const ioHost = CliIoHost.instance({ logLevel: 'info' }, /* forceNew */ true);
    const recorder = IoHostRecorder.create(ioHost);
    const ioHelper = asIoHelper(ioHost, 'destroy');

    await ioHelper.defaults.trace('a trace message');
    await ioHelper.defaults.debug('a debug message');
    await ioHelper.defaults.info('an info message');
    await ioHelper.defaults.warn('a warn message');
    await ioHelper.defaults.error('an error message');
    await ioHelper.defaults.result('a result message');

    // Every level is present, in order — nothing was dropped by the host's logLevel.
    const entries = recorder.entries();
    expect(entries.map((e) => e.level)).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'result',
    ]);
    expect(entries.map((e) => e.message)).toEqual([
      'a trace message',
      'a debug message',
      'an info message',
      'a warn message',
      'an error message',
      'a result message',
    ]);
  });

  test('records requests (with their resolved response) interleaved with notifications', async () => {
    const ioHost = CliIoHost.instance({ logLevel: 'trace' }, /* forceNew */ true);
    const recorder = IoHostRecorder.create(ioHost);
    const ioHelper = asIoHelper(ioHost, 'destroy');

    // Answer the request through a listener so the real `requestResponse` runs
    // (and is therefore observed) — the recorder never spies on it. The question
    // is not suppressed, so it stays in the recorded stream.
    const dispose = ioHost.on((m) => m.code === 'CDK_TOOLKIT_I0000', () => ({ respond: true }));

    await ioHelper.defaults.info('before');
    await ioHelper.requestResponse({
      time: new Date(),
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      message: 'are you sure?',
      data: undefined,
      defaultResponse: false,
    });
    await ioHelper.defaults.info('after');

    expect(recorder.entries()).toEqual([
      expect.objectContaining({ seq: 0, type: 'notify', message: 'before' }),
      expect.objectContaining({ seq: 1, type: 'request', message: 'are you sure?', response: true }),
      expect.objectContaining({ seq: 2, type: 'notify', message: 'after' }),
    ]);

    dispose();
  });

  test('keeps capturing after jest.resetAllMocks() — it observes rather than spying on the host', async () => {
    // This is the core robustness property: because the recorder only registers
    // an `observeMessages` observer (and never `jest.spyOn`s the host methods),
    // a command test's `jest.resetAllMocks()` in `beforeEach` has nothing of the
    // recorder's to neuter. The real `notify`/`requestResponse` keep running, so
    // notifications, requests and listener answers are all still captured.
    const ioHost = CliIoHost.instance({ logLevel: 'trace' }, /* forceNew */ true);
    const recorder = IoHostRecorder.create(ioHost);
    const ioHelper = asIoHelper(ioHost, 'destroy');

    // Mirror what command test files do at the top of every `beforeEach`.
    jest.resetAllMocks();

    // Answer the prompt the documented way, exactly as a rerouted command test
    // would (no `jest.spyOn(ioHost, 'requestResponse')` pass-through needed).
    // suppressQuestion=false keeps the (shown) prompt in the recorded stream.
    ioHost.respondOnce(IO.CDK_TOOLKIT_I7010, true, false);

    await ioHelper.defaults.info('before');
    const answer = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I7010.req('proceed?', { motivation: 'testing' }));
    await ioHelper.defaults.info('after');

    expect(answer).toBe(true);
    expect(recorder.entries()).toEqual([
      expect.objectContaining({ seq: 0, type: 'notify', message: 'before' }),
      expect.objectContaining({ seq: 1, type: 'request', code: 'CDK_TOOLKIT_I7010', response: true }),
      expect.objectContaining({ seq: 2, type: 'notify', message: 'after' }),
    ]);
  });

  test('the `level` option is the single place that decides which levels are snapshotted', async () => {
    // The host would print info-and-above; the recorder still *receives* every
    // level, but we ask it to only *include* warn-and-above in the snapshot.
    const ioHost = CliIoHost.instance({ logLevel: 'info' }, /* forceNew */ true);
    const recorder = IoHostRecorder.create(ioHost, { level: 'warn' });
    const ioHelper = asIoHelper(ioHost, 'destroy');

    await ioHelper.defaults.trace('a trace message');
    await ioHelper.defaults.debug('a debug message');
    await ioHelper.defaults.info('an info message');
    await ioHelper.defaults.warn('a warn message');
    await ioHelper.defaults.error('an error message');

    // trace/debug/info are dropped by the recorder's own threshold (not the host).
    expect((recorder.entries()).map((e) => e.level)).toEqual(['warn', 'error']);
  });

  test('marks a message a listener prevented from being written as `dropped`', async () => {
    const ioHost = CliIoHost.instance({ logLevel: 'trace' }, /* forceNew */ true);
    const recorder = IoHostRecorder.create(ioHost, { excludeDropped: false });
    const ioHelper = asIoHelper(ioHost, 'destroy');

    // Suppress a specific coded message, the way the CLI drops the synth/destroy
    // time lines on the destroy path.
    const dispose = ioHost.on((m) => m.code === 'CDK_TOOLKIT_I9999', () => ({ preventDefault: true }));

    await ioHelper.notify({ time: new Date(), level: 'info', code: 'CDK_TOOLKIT_I9999', message: 'suppressed', data: undefined });
    await ioHelper.defaults.info('shown');

    const entries = recorder.entries();
    expect(entries).toEqual([
      expect.objectContaining({ code: 'CDK_TOOLKIT_I9999', message: 'suppressed', dropped: true }),
      expect.objectContaining({ code: null, message: 'shown' }),
    ]);
    // A normally-written message carries no `dropped` flag.
    expect(entries[1]).not.toHaveProperty('dropped');

    dispose();
  });

  test('reflects a listener that rewrites the message text', async () => {
    const ioHost = CliIoHost.instance({ logLevel: 'trace' }, /* forceNew */ true);
    const recorder = IoHostRecorder.create(ioHost);
    const ioHelper = asIoHelper(ioHost, 'destroy');

    const dispose = ioHost.rewrite({ is: (m) => m.code === 'CDK_TOOLKIT_I9998' } as any, () => 'rewritten by listener');

    await ioHelper.notify({ time: new Date(), level: 'info', code: 'CDK_TOOLKIT_I9998', message: 'original', data: undefined });

    const entries = recorder.entries();
    expect(entries[0]).toEqual(expect.objectContaining({ code: 'CDK_TOOLKIT_I9998', message: 'rewritten by listener' }));

    dispose();
  });
});
