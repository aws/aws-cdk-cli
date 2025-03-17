import { mockSpawn } from './mock-child_process';
import mockfs from './mock-fs';
import { MockProgressListener } from './mock-progress-listener';
import { setLogThreshold } from '../bin/logging';
import { EventType, shellEventToEventType } from '../lib';
import type { ShellEventPublisher } from '../lib/private/shell';
import { shell } from '../lib/private/shell';

jest.mock('child_process');

describe('shell', () => {
  let progressListener: MockProgressListener;
  let shellEventPublisher: ShellEventPublisher;

  beforeEach(() => {
    progressListener = new MockProgressListener();
    shellEventPublisher = (event, message) => {
      const eventType = shellEventToEventType(event);
      progressListener.onPublishEvent(eventType, {
        message,
        percentComplete: 0,
        abort: () => {
        },
      });
    };
    mockfs({
      '/path/package.json': JSON.stringify({ version: '1.2.3' }),
    });
  });

  afterEach(() => {
    mockfs.restore();
  });

  test('docker stdout is captured during builds', async () => {
    // GIVEN
    setLogThreshold('verbose');

    const expectAllSpawns = mockSpawn({
      commandLine: ['docker', 'build', '.'],
      stdout: 'Step 1/3 : FROM node:14\nStep 2/3 : WORKDIR /app\nStep 3/3 : COPY . .',
    });

    // WHEN
    await shell(['docker', 'build', '.'], {
      shellEventPublisher,
      subprocessOutputDestination: 'publish',
    });

    // THEN
    expectAllSpawns();

    const dockerOutputMessages = progressListener.messages.filter(
      (msg) =>
        msg.type === EventType.SHELL_STDOUT &&
        (msg.message.includes('Step 1/3') ||
          msg.message.includes('Step 2/3') ||
          msg.message.includes('Step 3/3')),
    );

    expect(dockerOutputMessages.length).toBeGreaterThan(0);
  });

  test('stderr is captured', async () => {
    // GIVEN
    const expectAllSpawns = mockSpawn({
      commandLine: ['docker', 'build', '.'],
      stderr: 'Warning: Something went wrong',
    });

    // WHEN
    await shell(['docker', 'build', '.'], {
      shellEventPublisher,
      subprocessOutputDestination: 'publish',
    });

    // THEN
    expectAllSpawns();

    const errorMessages = progressListener.messages.filter((msg) =>
      msg.message.includes('Warning: Something went wrong'),
    );

    expect(errorMessages.length).toBeGreaterThan(0);
  });

  test('handles input option correctly', async () => {
    // GIVEN
    const expectedInput = 'some input';

    const expectAllSpawns = mockSpawn({
      commandLine: ['cat'],
      stdout: expectedInput,
    });

    // WHEN
    await shell(['cat'], {
      input: expectedInput,
      shellEventPublisher,
      subprocessOutputDestination: 'publish',
    });

    // THEN
    expectAllSpawns();

    const inputMessages = progressListener.messages.filter((msg) =>
      msg.message.includes(expectedInput),
    );

    expect(inputMessages.length).toBeGreaterThan(0);
  });

  test('throws error on non-zero exit code', async () => {
    // GIVEN
    const expectAllSpawns = mockSpawn({
      commandLine: ['docker', 'build', '.'],
      exitCode: 1,
      stderr: 'Command failed',
    });

    // WHEN/THEN
    await expect(
      shell(['docker', 'build', '.'], {
        shellEventPublisher,
        subprocessOutputDestination: 'publish',
      }),
    ).rejects.toThrow('Command failed');

    expectAllSpawns();

    const errorMessages = progressListener.messages.filter((msg) =>
      msg.message.includes('Command failed'),
    );

    expect(errorMessages.length).toBeGreaterThan(0);
  });

  test('emits proper shell event sequence', async () => {
    // GIVEN
    const expectAllSpawns = mockSpawn({
      commandLine: ['echo', 'hello'],
      stdout: 'hello',
    });

    // WHEN
    await shell(['echo', 'hello'], {
      shellEventPublisher,
      subprocessOutputDestination: 'publish',
    });

    // THEN
    expectAllSpawns();

    // Verify event sequence
    const events = progressListener.messages.map((msg) => msg.type);
    expect(events).toEqual([EventType.SHELL_OPEN, EventType.SHELL_STDOUT, EventType.SHELL_CLOSE]);
  });
});
