import { CliIoHost } from '../../../lib/cli/io-host';
import type { IoMessage } from '@aws-cdk/toolkit-lib';

describe('CliIoHost Events', () => {
  let ioHost: CliIoHost;

  beforeEach(() => {
    ioHost = CliIoHost.instance({}, true); // forceNew = true
  });

  test('emits events for notify messages', async () => {
    const fn = jest.fn();
    const listener = ioHost.on({ level: 'info' }, fn);

    const message: IoMessage<unknown> = {
      time: new Date(),
      level: 'info',
      action: 'deploy',
      message: 'Test message',
      data: {}
    };

    await ioHost.notify(message);

    expect(fn).toHaveBeenCalledWith(message);
    listener.off();
  });

  test('emits events for request messages', async () => {
    // Create ioHost with TTY enabled for request testing
    const ttyIoHost = CliIoHost.instance({ isTTY: true }, true);
    const fn = jest.fn();
    const listener = ttyIoHost.on({ level: 'info' }, fn);

    const request = {
      time: new Date(),
      level: 'info' as const,
      action: 'deploy' as const,
      code: 'CDK_TOOLKIT_I0001' as const,
      message: 'Test request',
      data: {},
      defaultResponse: 'test-value'
    };

    // Mock promptly to avoid actual user input
    const promptly = require('promptly');
    jest.spyOn(promptly, 'prompt').mockResolvedValue('test-value');

    await ttyIoHost.requestResponse(request);

    expect(fn).toHaveBeenCalledWith(request);
    listener.off();
  });

  test('supports multiple listener types', async () => {
    const onFn = jest.fn();
    const onceFn = jest.fn();
    const anyFn = jest.fn();
    const manyFn = jest.fn();

    const onListener = ioHost.on({ level: 'info' }, onFn);
    const onceListener = ioHost.once({ level: 'info' }, onceFn);
    const anyListener = ioHost.any({ level: 'info' }, anyFn);
    const manyListener = ioHost.many({ level: 'info' }, manyFn);

    const message: IoMessage<unknown> = {
      time: new Date(),
      level: 'info',
      action: 'deploy',
      message: 'Test message',
      data: {}
    };

    await ioHost.notify(message);
    await ioHost.notify(message);

    expect(onFn).toHaveBeenCalledTimes(2);
    expect(onceFn).toHaveBeenCalledTimes(1); // once only fires once
    expect(anyFn).toHaveBeenCalledTimes(2);
    expect(manyFn).toHaveBeenCalledTimes(2);

    onListener.off();
    onceListener.off();
    anyListener.off();
    manyListener.off();
  });
});