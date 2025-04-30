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
  const eventDate = new Date(T0 + 102 * 1000);
  mockCloudWatchClient.on(FilterLogEventsCommand).resolves({
    events: [event(102, 'message', eventDate)],
  });

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
  await sleep(1000);

  // THEN
  const expectedLocaleTimeString = eventDate.toLocaleTimeString();
  expect(ioHost.notifySpy).toHaveBeenCalledTimes(1);
  expect(stripAnsi(ioHost.notifySpy.mock.calls[0][0].message)).toContain(`[loggroup] ${expectedLocaleTimeString} message`);
});

test('process truncated events', async () => {
  // GIVEN
  const eventDate = new Date(T0 + 102 * 1000);
  const events: FilteredLogEvent[] = [];
  for (let i = 0; i < 100; i++) {
    events.push(event(102 + i, 'message' + i, eventDate));
  }

  mockCloudWatchClient.on(FilterLogEventsCommand).resolves({
    events,
    nextToken: 'some-token',
  });
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
  await sleep(1000);

  // THEN
  const expectedLocaleTimeString = eventDate.toLocaleTimeString();
  expect(ioHost.notifySpy).toHaveBeenCalledTimes(101);
  expect(stripAnsi(ioHost.notifySpy.mock.calls[0][0].message)).toContain(`[loggroup] ${expectedLocaleTimeString} message0`);
  expect(stripAnsi(ioHost.notifySpy.mock.calls[100][0].message)).toContain(
    `[loggroup] ${expectedLocaleTimeString} >>> \`watch\` shows only the first 100 log messages - the rest have been truncated...`,
  );
});

const T0 = 1597837230504;
const T100 = T0 + 100 * 1000;
function event(nr: number, message: string, timestamp: Date): FilteredLogEvent {
  return {
    eventId: `${nr}`,
    message,
    timestamp: timestamp.getTime(),
    ingestionTime: timestamp.getTime(),
  };
}
