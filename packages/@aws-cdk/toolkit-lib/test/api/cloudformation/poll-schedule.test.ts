import type { ICloudFormationClient } from '../../../lib/api/aws-auth/private';
import { isThrottlingError, PollSchedule, pollUntil } from '../../../lib/api/cloudformation/poll-schedule';
import { TestIoHost } from '../../_helpers/test-io-host';

const STACK_A = 'arn:aws:cloudformation:us-east-1:111111111111:stack/a/1';
const STACK_B = 'arn:aws:cloudformation:us-east-1:111111111111:stack/b/2';
const OTHER_ACCOUNT = 'arn:aws:cloudformation:us-east-1:222222222222:stack/c/3';
const OTHER_REGION = 'arn:aws:cloudformation:eu-west-1:111111111111:stack/d/4';

let ioHost: TestIoHost;

beforeEach(() => {
  jest.useFakeTimers();
  ioHost = new TestIoHost('debug');
});

afterEach(() => {
  jest.useRealTimers();
});

function throttlingError(headers?: Record<string, string>) {
  return Object.assign(new Error('Rate exceeded'), {
    name: 'Throttling',
    ...headers ? { $response: { headers } } : {},
  });
}

function fakeCfn(describeStacks: () => Promise<any>): ICloudFormationClient {
  return { describeStacks } as any;
}

function pacer(arn: string, interval = 2_000, description = 'stack a') {
  return PollSchedule.for(arn).pacer({ ioHelper: ioHost.asHelper('deploy'), interval, description });
}

/**
 * Throttle one request on the schedule of the given ARN
 */
async function throttleOnce(arn: string) {
  const cfn = PollSchedule.for(arn).observe(fakeCfn(() => Promise.reject(throttlingError())));
  await expect(cfn.describeStacks({})).rejects.toThrow('Rate exceeded');
}

describe('isThrottlingError', () => {
  test.each([
    ['Throttling', { name: 'Throttling' }],
    ['ThrottlingException', { name: 'ThrottlingException' }],
    ['an error the SDK marked as throttling', { name: 'Whatever', $retryable: { throttling: true } }],
    ['HTTP 429', { name: 'Whatever', $metadata: { httpStatusCode: 429 } }],
  ])('%s is throttling', (_, error) => {
    expect(isThrottlingError(error)).toBe(true);
  });

  test.each([
    ['ValidationError', { name: 'ValidationError' }],
    ['undefined', undefined],
  ])('%s is not throttling', (_, error) => {
    expect(isThrottlingError(error)).toBe(false);
  });
});

describe('pacing concurrent pollers', () => {
  test('polls in the same account and region take turns', async () => {
    // GIVEN
    const a = pacer(STACK_A);
    const b = pacer(STACK_B);
    const turns: string[] = [];

    // WHEN - both want to poll right now
    void a.slot().then(() => turns.push('a'));
    void b.slot().then(() => turns.push('b'));

    // THEN - one goes now, the other one a little later
    await jest.advanceTimersByTimeAsync(0);
    expect(turns).toEqual(['a']);
    await jest.advanceTimersByTimeAsync(100);
    expect(turns).toEqual(['a', 'b']);
  });

  test('polls in different accounts or regions do not wait for each other', async () => {
    // GIVEN
    const turns: string[] = [];

    // WHEN
    for (const [name, arn] of [['a', STACK_A], ['other account', OTHER_ACCOUNT], ['other region', OTHER_REGION]]) {
      void pacer(arn).slot().then(() => turns.push(name));
    }

    // THEN
    await jest.advanceTimersByTimeAsync(0);
    expect(turns).toEqual(['a', 'other account', 'other region']);
  });

  test('pollers that only know a stack name share a schedule', () => {
    expect(PollSchedule.for('my-stack')).toBe(PollSchedule.for('other-stack'));
  });

  test('the first ARN decides the schedule', () => {
    expect(PollSchedule.for('my-stack', STACK_A)).toBe(PollSchedule.for(STACK_B));
  });
});

describe('backing off', () => {
  test('a throttled request slows down every poller in the same account and region', async () => {
    // GIVEN
    const a = pacer(STACK_A, 2_000);
    const b = pacer(STACK_B, 5_000);
    const other = pacer(OTHER_ACCOUNT, 2_000);

    // WHEN
    await throttleOnce(STACK_A);

    // THEN
    expect(await a.nextInterval()).toEqual(4_000);
    expect(await b.nextInterval()).toEqual(10_000);
    expect(await other.nextInterval()).toEqual(2_000);
  });

  test('a request that only succeeded after the SDK retried it slows down polling', async () => {
    // GIVEN
    const a = pacer(STACK_A);
    const cfn = PollSchedule.for(STACK_A).observe(fakeCfn(async () => ({ $metadata: { attempts: 2 } })));

    // WHEN
    await cfn.describeStacks({});

    // THEN
    expect(await a.nextInterval()).toEqual(4_000);
  });

  test('a request that succeeded the first time does not slow down polling', async () => {
    // GIVEN
    const a = pacer(STACK_A);
    const cfn = PollSchedule.for(STACK_A).observe(fakeCfn(async () => ({ $metadata: { attempts: 1 } })));

    // WHEN
    await cfn.describeStacks({});

    // THEN
    expect(await a.nextInterval()).toEqual(2_000);
  });

  test('many pollers throttled at the same moment slow down polling once', async () => {
    // GIVEN
    const a = pacer(STACK_A);

    // WHEN
    for (let i = 0; i < 10; i++) {
      await throttleOnce(STACK_A);
    }

    // THEN
    expect(await a.nextInterval()).toEqual(4_000);
  });

  test('throttling that goes on slows down polling further, up to a minute', async () => {
    // GIVEN
    const a = pacer(STACK_A);

    // WHEN
    for (let i = 0; i < 10; i++) {
      await throttleOnce(STACK_A);
      await jest.advanceTimersByTimeAsync(2_000);
    }

    // THEN
    expect(await a.nextInterval()).toEqual(60_000);
  });

  test('polls are spaced further apart while backing off', async () => {
    // GIVEN
    const a = pacer(STACK_A);
    const b = pacer(STACK_B);
    await throttleOnce(STACK_A);
    const turns: string[] = [];

    // WHEN
    void a.slot().then(() => turns.push('a'));
    void b.slot().then(() => turns.push('b'));

    // THEN
    await jest.advanceTimersByTimeAsync(199);
    expect(turns).toEqual(['a']);
    await jest.advanceTimersByTimeAsync(1);
    expect(turns).toEqual(['a', 'b']);
  });

  test('polling speeds up again once throttling stops', async () => {
    // GIVEN - backed off 4x
    const a = pacer(STACK_A);
    await throttleOnce(STACK_A);
    await jest.advanceTimersByTimeAsync(2_000);
    await throttleOnce(STACK_A);
    expect(await a.nextInterval()).toEqual(8_000);

    // WHEN / THEN - halves for every 20s without throttling
    await jest.advanceTimersByTimeAsync(20_000);
    expect(await a.nextInterval()).toEqual(4_000);
    await jest.advanceTimersByTimeAsync(20_000);
    expect(await a.nextInterval()).toEqual(2_000);
  });

  test('backoff is remembered between pollers', async () => {
    // GIVEN - a poller that was throttled and is done
    const a = pacer(STACK_A);
    await throttleOnce(STACK_A);
    a.release();

    // WHEN
    const b = pacer(STACK_B);

    // THEN
    expect(await b.nextInterval()).toEqual(4_000);
  });

  test('a Retry-After hint delays the next poll', async () => {
    // GIVEN
    const a = pacer(STACK_A);
    const cfn = PollSchedule.for(STACK_A).observe(fakeCfn(() => Promise.reject(throttlingError({ 'Retry-After': '3' }))));
    await expect(cfn.describeStacks({})).rejects.toThrow();
    let polled = false;

    // WHEN
    void a.slot().then(() => {
      polled = true;
    });

    // THEN
    await jest.advanceTimersByTimeAsync(2_999);
    expect(polled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(polled).toBe(true);
  });

  test('an x-amz-retry-after hint in milliseconds delays the next poll', async () => {
    // GIVEN
    const a = pacer(STACK_A);
    const cfn = PollSchedule.for(STACK_A).observe(fakeCfn(() => Promise.reject(throttlingError({ 'x-amz-retry-after': '1500' }))));
    await expect(cfn.describeStacks({})).rejects.toThrow();
    let polled = false;

    // WHEN
    void a.slot().then(() => {
      polled = true;
    });

    // THEN
    await jest.advanceTimersByTimeAsync(1_499);
    expect(polled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(polled).toBe(true);
  });
});

describe('reporting', () => {
  test('a change of polling interval is reported for -v', async () => {
    // GIVEN
    const a = pacer(STACK_A, 2_000, 'stack a');
    await throttleOnce(STACK_A);

    // WHEN
    await a.nextInterval();

    // THEN
    ioHost.expectMessage({
      level: 'debug',
      containing: 'CloudFormation is throttling requests in account 111111111111 in us-east-1, polling stack a every 4s',
    });
  });

  test('polling every 30s or more because of throttling is a warning, once', async () => {
    // GIVEN - stabilizing a stack is polled every 5s, so 8x backoff takes it to 40s
    const a = pacer(STACK_A, 5_000, 'stack a');
    const b = pacer(STACK_B, 5_000, 'stack b');
    for (let i = 0; i < 3; i++) {
      await throttleOnce(STACK_A);
      await jest.advanceTimersByTimeAsync(2_000);
    }

    // WHEN
    await a.nextInterval();
    await b.nextInterval();
    await a.nextInterval();

    // THEN
    const warnings = ioHost.messages.filter((m) => m.code === 'CDK_TOOLKIT_W5501');
    expect(warnings).toEqual([expect.objectContaining({
      level: 'warn',
      message: expect.stringContaining('CloudFormation is throttling requests in account 111111111111 in us-east-1, progress of stack a is only checked every 40s'),
    })]);
  });

  test('a long polling interval that was asked for is not a warning', async () => {
    // GIVEN
    const a = pacer(STACK_A, 45_000);

    // WHEN
    await a.nextInterval();

    // THEN
    expect(ioHost.messages.filter((m) => m.level === 'warn')).toEqual([]);
  });
});

describe('pollUntil', () => {
  test('keeps polling through throttling for as long as it takes', async () => {
    // GIVEN - throttled for well over the SDK's own retries
    let polls = 0;
    const provider = async () => {
      polls++;
      if (polls <= 50) {
        throw throttlingError();
      }
      return 'done';
    };

    // WHEN
    const result = pollUntil(pacer('my-stack'), provider);
    await jest.advanceTimersByTimeAsync(60 * 60_000);

    // THEN
    await expect(result).resolves.toEqual('done');
    ioHost.expectMessage({ level: 'debug', containing: 'Throttled while polling stack a, polling again later' });
  });

  test('other errors end the polling', async () => {
    // GIVEN
    const provider = async () => {
      throw Object.assign(new Error('Access denied'), { name: 'AccessDenied' });
    };

    // WHEN / THEN
    await expect(pollUntil(pacer('my-stack'), provider)).rejects.toThrow('Access denied');
  });

  test('null ends the polling with undefined', async () => {
    await expect(pollUntil(pacer('my-stack'), async () => null)).resolves.toBeUndefined();
  });
});
