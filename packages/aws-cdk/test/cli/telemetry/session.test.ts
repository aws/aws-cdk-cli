import { Context } from '../../../lib/api/context';
import { CliIoHost } from '../../../lib/cli/io-host';
import { TelemetrySession } from '../../../lib/cli/telemetry/session';

let ioHost: CliIoHost;
let session: TelemetrySession;
let clientEmitSpy: jest.SpyInstance<any, unknown[], any>;
let clientFlushSpy: jest.SpyInstance<any, unknown[], any>;

describe('TelemetrySession', () => {
  beforeEach(async () => {
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    session = new TelemetrySession({
      ioHost,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await session.begin();

    const privateClient = (session as any)._client;
    clientEmitSpy = jest.spyOn(privateClient, 'emit');
    clientFlushSpy = jest.spyOn(privateClient, 'flush');
  });

  test('can emit data to the client', async () => {
    // WHEN
    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        state: 'SUCCEEDED',
      }),
    }));
  });

  test('state is failed if error supplied', async () => {
    // WHEN
    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
      error: {
        name: 'ToolkitError',
      },
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        state: 'FAILED',
      }),
    }));
  });

  test('state is aborted if special error supplied', async () => {
    // WHEN
    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
      error: {
        name: 'ToolkitError',
        message: 'Subprocess exited with error null',
      },
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        state: 'ABORTED',
      }),
    }));
  });

  test('ci is recorded properly', async () => {
    // GIVEN
    const CI = process.env.CI;
    const NOT_CI = CI === 'true' ? 'false' : 'true';
    process.env.CI = NOT_CI;
    const ciSession = new TelemetrySession({
      ioHost,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await ciSession.begin();

    const privateCiInfo = (ciSession as any)._sessionInfo;
    const privateInfo = (session as any)._sessionInfo;

    // THEN
    expect(privateCiInfo).toEqual(expect.objectContaining({
      environment: expect.objectContaining({
        ci: NOT_CI,
      }),
    }));
    expect(privateInfo).toEqual(expect.objectContaining({
      environment: expect.objectContaining({
        ci: CI,
      }),
    }));
    process.env.CI = CI;
  });

  test('emit messsages are counted correctly', async () => {
    // WHEN
    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });
    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      identifiers: expect.objectContaining({
        eventId: expect.stringContaining(':1'),
      }),
    }));
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      identifiers: expect.objectContaining({
        eventId: expect.stringContaining(':2'),
      }),
    }));
  });

  test('calling end more than once results in no-op', async () => {
    // GIVEN
    const privateSpan = (session as any).span;
    const spanEndSpy = jest.spyOn(privateSpan, 'end');

    // WHEN
    await session.end();
    await session.end();
    await session.end();

    // THEN
    expect(spanEndSpy).toHaveBeenCalledTimes(1);
  });

  test('end flushes events', async () => {
    // GIVEN
    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // WHEN
    await session.end();

    // THEN
    expect(clientFlushSpy).toHaveBeenCalledTimes(1);
  });
});
