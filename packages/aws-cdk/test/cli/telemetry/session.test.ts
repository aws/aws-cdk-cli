import { Context } from '../../../lib/api/context';
import { CliIoHost } from '../../../lib/cli/io-host';
import { IoHostTelemetrySink } from '../../../lib/cli/telemetry/io-host-sink';
import type { TelemetrySchema } from '../../../lib/cli/telemetry/schema';
import { TelemetrySession } from '../../../lib/cli/telemetry/session';
import { withEnv } from '../../_helpers/with-env';

let ioHost: CliIoHost;
let session: TelemetrySession;
let clientEmitSpy: jest.SpyInstance<any, [event: TelemetrySchema], any>;
let clientFlushSpy: jest.SpyInstance<any, unknown[], any>;

describe('TelemetrySession', () => {
  beforeEach(async () => {
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });

    session = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await session.begin();

    clientEmitSpy = jest.spyOn(client, 'emit');
    clientFlushSpy = jest.spyOn(client, 'flush');
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
        eventType: 'SYNTH',
      }),
      duration: expect.objectContaining({
        total: 1234,
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

test('ci is recorded properly - true', async () => {
  await withEnv(async () => {
    // GIVEN
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });
    clientEmitSpy = jest.spyOn(client, 'emit');
    const ciSession = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await ciSession.begin();

    // WHEN
    await ciSession.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    console.log('CI', process.env.CI);

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      environment: expect.objectContaining({
        ci: true,
      }),
    }));
  }, {
    CI: 'true',
  });
});

test('ci is recorded properly - true', async () => {
  await withEnv(async () => {
    // GIVEN
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });
    clientEmitSpy = jest.spyOn(client, 'emit');
    const ciSession = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await ciSession.begin();

    // WHEN
    await ciSession.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    console.log('CI', process.env.CI);

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      environment: expect.objectContaining({
        ci: false,
      }),
    }));
  }, {
    CI: 'false',
  });
});

