import type { IoMessage, IoMessageCode } from '../../../../lib/api/io';
import { ListenerRegistry, matchAny } from '../../../../lib/api/io/private/listener-registry';

const I2901: IoMessageCode = 'CDK_TOOLKIT_I2901';

function notification(over: Partial<IoMessage<any>> = {}): IoMessage<any> {
  return {
    time: new Date('2024-01-01T12:00:00'),
    level: 'info',
    action: 'synth',
    code: I2901,
    message: 'the original text',
    data: {},
    ...over,
  };
}

// `matchAny` is private to the toolkit: its only callers are inside the CLI,
// where the message makers needed to build anything interesting are also private.
describe('matchAny', () => {
  let registry: ListenerRegistry;

  beforeEach(() => {
    registry = new ListenerRegistry();
  });

  test('combines type guards and plain predicates', async () => {
    const isList = (m: IoMessage<unknown>): m is IoMessage<{ stacks: unknown[] }> => m.code === I2901;
    const seen: Array<string | undefined> = [];
    registry.on(matchAny(isList, (m) => m.level === 'warn'), (m) => {
      seen.push(m.code);
    });

    await registry.apply(notification());
    await registry.apply(notification({ code: 'CDK_TOOLKIT_I0001', level: 'warn' }));
    await registry.apply(notification({ code: 'CDK_TOOLKIT_I0001' }));

    expect(seen).toEqual([I2901, 'CDK_TOOLKIT_I0001']);
  });

  test('matches a message only once even if several of its matchers match', async () => {
    const fn = jest.fn();
    registry.on(matchAny((m) => m.code === I2901, (m) => m.level === 'info'), fn);

    await registry.apply(notification());

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('with no matchers, never matches', async () => {
    const fn = jest.fn();
    registry.on(matchAny(), fn);

    await registry.apply(notification());

    expect(fn).not.toHaveBeenCalled();
  });
});
