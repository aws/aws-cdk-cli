/* eslint-disable @typescript-eslint/unbound-method */
import type { IActionAwareIoHost } from '../../../lib';
import type { SpanDefinition } from '../../../lib/api/io/private';
import { IoHelper, SpanMaker } from '../../../lib/api/io/private';
import * as maker from '../../../lib/api/io/private/message-maker';

const makeHelper = (span: IActionAwareIoHost) => IoHelper.fromActionAwareIoHost(span);

describe('SpanMaker', () => {
  let ioHelper: jest.Mocked<IoHelper>;

  beforeEach(() => {
    ioHelper = {
      notify: jest.fn(),
    } as any;
  });

  test('begin creates span with unique id and sends start message', async () => {
    // GIVEN
    const definition: SpanDefinition<{}, { duration: number }> = {
      name: 'Test Span',
      start: maker.info<{}>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'test',
        interface: 'stuff',
      }),
      end: maker.info<{ duration: number }>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'test',
        interface: 'stuff',
      }),
    };
    const spanMaker = new SpanMaker(ioHelper, definition, makeHelper);

    // WHEN
    await spanMaker.begin('Test span', {});

    // THEN
    expect(ioHelper.notify).toHaveBeenCalledTimes(1);
    const notifyCall = ioHelper.notify.mock.calls[0][0];
    expect(notifyCall.message).toBe('Test span');
    expect(notifyCall.span).toBeDefined(); // UUID should be set
  });

  test('end returns elapsed time and sends end message', async () => {
    // GIVEN
    const definition: SpanDefinition<{}, { duration: number }> = {
      name: 'Test Span',
      start: maker.info<{}>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Starting span',
        interface: 'stuff',
      }),
      end: maker.info<{ duration: number }>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Ending span',
        interface: 'stuff',
      }),
    };
    const spanMaker = new SpanMaker(ioHelper, definition, makeHelper);

    // WHEN
    const messageSpan = await spanMaker.begin('Test span', {});
    const result = await messageSpan.end();

    // THEN
    expect(result.asMs).toBeGreaterThanOrEqual(0);
    expect(ioHelper.notify).toHaveBeenCalledTimes(2);
    const endCall = ioHelper.notify.mock.calls[1][0] as any;
    expect(endCall.message).toContain('Test Span time');
    expect(endCall.span).toBeDefined();
    expect(endCall.data.duration).toBeGreaterThanOrEqual(0);
  });

  test('intermediate messages are sent with same span id', async () => {
    // GIVEN
    const definition: SpanDefinition<{}, { duration: number }> = {
      name: 'Test Span',
      start: maker.info<{}>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Starting span',
        interface: 'stuff',
      }),
      end: maker.info<{ duration: number }>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Ending span',
        interface: 'stuff',
      }),
    };
    const spanMaker = new SpanMaker(ioHelper, definition, makeHelper);

    // WHEN
    const messageSpan = await spanMaker.begin('Test span', {});
    await messageSpan.notify({
      message: 'Intermediate message',
      code: 'CDK_TOOLKIT_I1234',
      time: new Date(),
      level: 'error',
      data: undefined,
    });
    await messageSpan.end();

    // THEN
    expect(ioHelper.notify).toHaveBeenCalledTimes(3);
    const spanId = ioHelper.notify.mock.calls[0][0].span;
    expect(ioHelper.notify.mock.calls[1][0].span).toBe(spanId);
    expect(ioHelper.notify.mock.calls[2][0].span).toBe(spanId);
  });

  test('end with payload overrides default elapsed time payload', async () => {
    // GIVEN
    const definition: SpanDefinition<{}, { customField: string; duration: number }> = {
      name: 'Test Span',
      start: maker.info<{}>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Starting span',
        interface: 'stuff',
      }),
      end: maker.info<{ customField: string; duration: number }>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Ending span',
        interface: 'stuff',
      }),
    };
    const spanMaker = new SpanMaker(ioHelper, definition, makeHelper);

    // WHEN
    const messageSpan = await spanMaker.begin('Test span', {});
    const result = await messageSpan.end({ customField: 'test value' });

    // THEN
    expect(result).toEqual({ asMs: expect.any(Number), asSec: expect.any(Number) });
    const endCall = ioHelper.notify.mock.calls[1][0];
    expect(endCall.data).toEqual(expect.objectContaining({ customField: 'test value' }));
  });

  test('begin with payload includes payload in start message', async () => {
    // GIVEN
    const definition: SpanDefinition<{ startField: string }, { duration: number }> = {
      name: 'Test Span',
      start: maker.info<{ startField: string }>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Starting span',
        interface: 'stuff',
      }),
      end: maker.info<{ duration: number }>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Ending span',
        interface: 'stuff',
      }),
    };
    const spanMaker = new SpanMaker(ioHelper, definition, makeHelper);

    // WHEN
    await spanMaker.begin('Test span', { startField: 'test value' });

    // THEN
    const startCall = ioHelper.notify.mock.calls[0][0];
    expect(startCall.data).toEqual({ startField: 'test value' });
  });

  test('endWithMessage allows custom end message', async () => {
    // GIVEN
    const definition: SpanDefinition<{}, { duration: number }> = {
      name: 'Test Span',
      start: maker.info<{}>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Starting span',
        interface: 'stuff',
      }),
      end: maker.info<{ duration: number }>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Ending span',
        interface: 'stuff',
      }),
    };
    const spanMaker = new SpanMaker(ioHelper, definition, makeHelper);

    // WHEN
    const messageSpan =await spanMaker.begin('Test span', {});
    await messageSpan.end('Custom end message');

    // THEN
    const endCall = ioHelper.notify.mock.calls[1][0];
    expect(endCall.message).toBe('Custom end message');
  });

  test('timing sends timing message with elapsed time', async () => {
    // GIVEN
    const definition: SpanDefinition<{}, { duration: number }> = {
      name: 'Test Span',
      start: maker.info<{}>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Starting span',
        interface: 'stuff',
      }),
      end: maker.info<{ duration: number }>({
        code: 'CDK_TOOLKIT_I1234',
        description: 'Ending span',
        interface: 'stuff',
      }),
    };
    const spanMaker = new SpanMaker(ioHelper, definition, makeHelper);

    // WHEN
    const messageSpan = await spanMaker.begin('Test span', {});
    const elapsedTime = await messageSpan.timing(maker.info({
      code: 'CDK_TOOLKIT_I1234',
      description: 'Timing message',
      interface: 'stuff',
    }), 'Custom timing message');

    // THEN
    expect(elapsedTime.asMs).toBeGreaterThanOrEqual(0);
    expect(ioHelper.notify).toHaveBeenCalledTimes(2);
    const timingCall = ioHelper.notify.mock.calls[1][0] as any;
    expect(timingCall.message).toBe('Custom timing message');
    expect(timingCall.span).toBeDefined();
    expect(timingCall.data.duration).toBeGreaterThanOrEqual(0);
  });
});
