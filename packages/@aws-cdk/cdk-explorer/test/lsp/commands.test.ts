import type { SynthRunResult } from '../../lib/core/synth-runner';
import {
  COMMAND_REFRESH,
  COMMAND_SYNTH_NOW,
  executeCommand,
  type CommandHandlerOptions,
  type NotifySink,
} from '../../lib/lsp/commands';

interface CapturedNotify extends NotifySink {
  info: jest.Mock;
  error: jest.Mock;
  withProgress: jest.Mock;
  /** All progress message strings passed to withProgress, in order. */
  progressMessages: string[];
}

function createNotify(): CapturedNotify {
  const progressMessages: string[] = [];
  const info = jest.fn();
  const error = jest.fn();
  const withProgress = jest.fn(async (message: string, fn: () => Promise<unknown>) => {
    progressMessages.push(message);
    return fn();
  });
  return { info, error, withProgress, progressMessages };
}

function makeOptions(overrides: Partial<CommandHandlerOptions> = {}): {
  options: CommandHandlerOptions;
  notify: CapturedNotify;
  synth: jest.Mock;
  refresh: jest.Mock;
} {
  const notify = createNotify();
  const synth = jest.fn(async () => ({ status: 'success' } as SynthRunResult));
  const refresh = jest.fn();
  return {
    notify,
    synth,
    refresh,
    options: {
      synth,
      refresh,
      synthAvailable: true,
      notify,
      ...overrides,
    },
  };
}

describe('executeCommand', () => {
  test('refresh calls refresh() and does not notify', async () => {
    const { options, notify, refresh, synth } = makeOptions();

    await executeCommand(COMMAND_REFRESH, [], options);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(synth).not.toHaveBeenCalled();
    expect(notify.info).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  test('synthNow shows info and skips synth when unavailable', async () => {
    const { options, notify, synth } = makeOptions({ synthAvailable: false });

    await executeCommand(COMMAND_SYNTH_NOW, [], options);

    expect(synth).not.toHaveBeenCalled();
    expect(notify.info).toHaveBeenCalledWith(expect.stringContaining('cdk.json'));
    expect(notify.error).not.toHaveBeenCalled();
  });

  test('synthNow runs synth under withProgress on success and notifies nothing', async () => {
    const { options, notify, synth } = makeOptions();

    await executeCommand(COMMAND_SYNTH_NOW, [], options);

    expect(synth).toHaveBeenCalledTimes(1);
    expect(notify.progressMessages).toEqual([expect.stringContaining('Synthesizing')]);
    expect(notify.info).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  test('synthNow surfaces app-failure as an error notification', async () => {
    const { options, notify } = makeOptions({
      synth: jest.fn(async () => ({ status: 'app-failure', message: 'TypeError: x' })),
    });

    await executeCommand(COMMAND_SYNTH_NOW, [], options);

    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('TypeError: x'));
    expect(notify.info).not.toHaveBeenCalled();
  });

  test('synthNow surfaces lock-conflict as an info notification', async () => {
    const { options, notify } = makeOptions({
      synth: jest.fn(async () => ({ status: 'lock-conflict' })),
    });

    await executeCommand(COMMAND_SYNTH_NOW, [], options);

    expect(notify.info).toHaveBeenCalledWith(expect.stringContaining('in progress'));
    expect(notify.error).not.toHaveBeenCalled();
  });

  test('synthNow surfaces a generic error as an error notification', async () => {
    const { options, notify } = makeOptions({
      synth: jest.fn(async () => ({ status: 'error', message: 'disk full' })),
    });

    await executeCommand(COMMAND_SYNTH_NOW, [], options);

    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    expect(notify.info).not.toHaveBeenCalled();
  });

  test('unknown commands are silently ignored', async () => {
    const { options, notify, refresh, synth } = makeOptions();

    await executeCommand('cdk.explorer.bogus', [], options);

    expect(refresh).not.toHaveBeenCalled();
    expect(synth).not.toHaveBeenCalled();
    expect(notify.info).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });
});
