import { FilterLogEventsCommand, type FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchLogEventMonitor } from '../../../lib/api/logs-monitor';
import { MockSdk, mockCloudWatchClient } from '../../_helpers/mock-sdk';
import { sleep } from '../../_helpers/sleep';
import { TestIoHost } from '../../_helpers/test-io-host';

// Helper function to strip ANSI codes
const stripAnsi = (str: string): string => {
  const ansiRegex = /\u001b\[[0-9;]*[a-zA-Z]/g;
  return str.replace(ansiRegex, '');
};

let sdk: MockSdk;
let monitor: CloudWatchLogEventMonitor;
let ioHost = new TestIoHost();
beforeEach(() => {
  mockCloudWatchClient.reset();
  monitor = new CloudWatchLogEventMonitor({
    ioHelper: ioHost.asHelper('deploy'),
    startTime: new Date(T100),
  });
  sdk = new MockSdk();
});

afterEach(async () => {
  ioHost.notifySpy.mockReset();
  ioHost.requestSpy.mockReset();
  await monitor.deactivate();
});

test('process events', async () => {
  // GIVEN
  const eventDate = new Date(T102);
  mockCloudWatchClient.on(FilterLogEventsCommand)
    .resolvesOnce({ events: [event(102, 'message', eventDate)] })
    .resolves({ events: [] });

  monitor.addLogGroups(
    {
      name: 'name',
      account: '11111111111',
      region: 'us-east-1',
    },
    sdk,
    ['loggroup'],
  );
  // WHEN
  await monitor.activate();
  // need time for the log processing to occur
  await sleep(2500);

  // THEN
  const expectedLocaleTimeString = eventDate.toLocaleTimeString();
  expect(ioHost.notifySpy).toHaveBeenCalledTimes(1);
  expect(stripAnsi(ioHost.notifySpy.mock.calls[0][0].message)).toContain(`[loggroup] ${expectedLocaleTimeString} message`);
});

test('process truncated events', async () => {
  // GIVEN
  const eventDate = new Date(T102);
  const events: FilteredLogEvent[] = [];
  for (let i = 0; i < 100; i++) {
    events.push(event(102 + i, 'message' + i, eventDate));
  }

  mockCloudWatchClient.on(FilterLogEventsCommand)
    .resolvesOnce({ events, nextToken: 'some-token' })
    .resolves({ events: [] });

  monitor.addLogGroups(
    {
      name: 'name',
      account: '11111111111',
      region: 'us-east-1',
    },
    sdk,
    ['loggroup'],
  );
  // WHEN
  await monitor.activate();
  // need time for the log processing to occur
  await sleep(2500);

  // THEN
  const expectedLocaleTimeString = eventDate.toLocaleTimeString();
  expect(ioHost.notifySpy).toHaveBeenCalledTimes(101);
  expect(stripAnsi(ioHost.notifySpy.mock.calls[0][0].message)).toContain(`[loggroup] ${expectedLocaleTimeString} message0`);
  expect(stripAnsi(ioHost.notifySpy.mock.calls[100][0].message)).toContain(
    `[loggroup] ${expectedLocaleTimeString} >>> \`watch\` shows only the first 100 log messages - the rest have been truncated...`,
  );
});

describe('when reading one log group fails', () => {
  const env = { name: 'name', account: '11111111111', region: 'us-east-1' };
  const throttle = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });

  function messages(): string[] {
    return ioHost.notifySpy.mock.calls.map((call) => stripAnsi(call[0].message));
  }

  test('a throttled log group does not discard the events of the other log groups, and is read again later', async () => {
    // GIVEN
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: 'group-a' })
      .resolvesOnce({ events: [event(102, 'message-a', new Date(T102))] })
      .resolves({ events: [] });
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: 'group-b' })
      .rejectsOnce(throttle)
      .resolvesOnce({ events: [event(103, 'message-b', new Date(T102))] })
      .resolves({ events: [] });
    monitor.addLogGroups(env, sdk, ['group-a', 'group-b']);

    // WHEN
    await monitor.activate();
    await sleep(2500);

    // THEN
    expect(messages()).toEqual([
      expect.stringContaining('[group-a]'),
      expect.stringContaining('[group-b]'),
    ]);
    expect(messages()[0]).toContain('message-a');
    expect(messages()[1]).toContain('message-b');
  });

  test('other errors are still reported, without discarding the events of the other log groups', async () => {
    // GIVEN
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: 'group-a' })
      .resolvesOnce({ events: [event(102, 'message-a', new Date(T102))] })
      .resolves({ events: [] });
    mockCloudWatchClient.on(FilterLogEventsCommand, { logGroupName: 'group-b' })
      .rejectsOnce(new Error('Access denied'))
      .resolves({ events: [] });
    monitor.addLogGroups(env, sdk, ['group-a', 'group-b']);

    // WHEN
    await monitor.activate();
    await sleep(500);

    // THEN
    expect(messages()).toEqual([
      expect.stringContaining('message-a'),
      expect.stringContaining('Error occurred while monitoring logs: Error: Access denied'),
    ]);
  });
});

const T0 = 1597837230504;
const T100 = T0 + 100 * 1000;
const T102 = T0 + 102 * 1000;
function event(nr: number, message: string, timestamp: Date): FilteredLogEvent {
  return {
    eventId: `${nr}`,
    message,
    timestamp: timestamp.getTime(),
    ingestionTime: timestamp.getTime(),
  };
}
