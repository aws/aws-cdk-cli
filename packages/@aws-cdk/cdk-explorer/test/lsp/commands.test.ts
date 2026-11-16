import {
  COMMAND_SYNTH_NOW,
  COMMAND_ENABLE_AUTO_SYNTH,
  COMMAND_DISABLE_AUTO_SYNTH,
  SUPPORTED_COMMANDS,
  executeCommand,
  type CommandHandlerOptions,
  type NotifySink,
} from '../../lib/lsp/commands';

interface CapturedNotify extends NotifySink {
  info: jest.Mock;
  error: jest.Mock;
  withProgress: jest.Mock;
  progressMessages: string[];
}

function createNotify(): CapturedNotify {
  const progressMessages: string[] = [];
  return {
    info: jest.fn(),
    error: jest.fn(),
    progressMessages,
    withProgress: jest.fn(async (message: string, fn: () => Promise<unknown>) => {
      progressMessages.push(message);
      return fn();
    }),
  };
}

function makeOptions(overrides: Partial<CommandHandlerOptions> = {}): {
  options: CommandHandlerOptions;
  notify: CapturedNotify;
  synth: jest.Mock;
  toggleAutoSynth: jest.Mock;
} {
  const notify = createNotify();
  const synth = jest.fn(async () => undefined);
  const toggleAutoSynth = jest.fn();
  return {
    notify,
    synth,
    toggleAutoSynth,
    options: { synth, toggleAutoSynth, notify, ...overrides },
  };
}

describe('executeCommand', () => {
  test.each([
    [COMMAND_ENABLE_AUTO_SYNTH, true],
    [COMMAND_DISABLE_AUTO_SYNTH, false],
  ])('%s toggles auto-synth to %s', async (command, expected) => {
    const { options, toggleAutoSynth, synth } = makeOptions();

    await executeCommand(command, [], options);

    expect(toggleAutoSynth).toHaveBeenCalledWith(expected);
    // Toggling is a state change only; it must not synth as a side effect.
    expect(synth).not.toHaveBeenCalled();
  });

  test('synthNow runs exactly one synth', async () => {
    const { options, synth } = makeOptions();

    await executeCommand(COMMAND_SYNTH_NOW, [], options);

    expect(synth).toHaveBeenCalledTimes(1);
  });

  test('synthNow runs the synth inside the progress indicator', async () => {
    // The indicator has to be open while the synth runs, not merely around it,
    // or the user gets no feedback for the duration.
    const { options, notify, synth } = makeOptions();
    let progressOpenDuringSynth = false;
    notify.withProgress.mockImplementation(async (message: string, fn: () => Promise<unknown>) => {
      notify.progressMessages.push(message);
      synth.mockImplementation(async () => {
        progressOpenDuringSynth = true;
      });
      return fn();
    });

    await executeCommand(COMMAND_SYNTH_NOW, [], options);

    expect(notify.progressMessages).toEqual([expect.stringContaining('Synthesizing')]);
    expect(progressOpenDuringSynth).toBe(true);
  });

  test('synthNow reports outcomes through diagnostics, not notifications', async () => {
    // The dispatcher no longer inspects the synth result: failures surface as
    // editor diagnostics (see synth-failure diagnostics in server.test.ts), so
    // a successful run is silent here and so is a failing one.
    const { options, notify } = makeOptions();

    await executeCommand(COMMAND_SYNTH_NOW, [], options);

    expect(notify.info).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  test('synthNow lets a rejecting synth propagate to the caller', async () => {
    // `synth` is documented as never rejecting; if it ever does, the dispatcher
    // must not swallow it into a silent no-op.
    const { options } = makeOptions({
      synth: jest.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(executeCommand(COMMAND_SYNTH_NOW, [], options)).rejects.toThrow('boom');
  });

  test('an unknown command is ignored without touching anything', async () => {
    const { options, notify, synth, toggleAutoSynth } = makeOptions();

    await executeCommand('cdk.explorer.bogus', [], options);

    expect(synth).not.toHaveBeenCalled();
    expect(toggleAutoSynth).not.toHaveBeenCalled();
    expect(notify.info).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.withProgress).not.toHaveBeenCalled();
  });

  test('every advertised command is handled', async () => {
    // Guards against advertising a command via executeCommandProvider that the
    // dispatcher then silently drops.
    for (const command of SUPPORTED_COMMANDS) {
      const { options, synth, toggleAutoSynth } = makeOptions();

      await executeCommand(command, [], options);

      expect(synth.mock.calls.length + toggleAutoSynth.mock.calls.length).toBeGreaterThan(0);
    }
  });
});
