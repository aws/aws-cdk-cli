import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { Context } from '../../../lib/api/context';
import { CliIoHost } from '../../../lib/cli/io-host';
import { type TelemetrySchema } from '../../../lib/cli/telemetry/schema';
import { TelemetrySession, isValidWrapperUserAgent } from '../../../lib/cli/telemetry/session';
import { IoHostTelemetrySink } from '../../../lib/cli/telemetry/sink/io-host-sink';
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
        name: ToolkitError.name,
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
        name: ToolkitError.name,
        message: '__CDK-Toolkit__Aborted',
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
    const spanEndSpy = jest.spyOn(session.commandSpan!, 'end');

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

  test('attach cdk library version', async () => {
    session.attachCdkLibVersion('1.2.3');

    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      identifiers: expect.objectContaining({
        cdkLibraryVersion: '1.2.3',
      }),
    }));
  });

  test('attach language', async () => {
    session.attachLanguage('basic');

    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      project: expect.objectContaining({
        language: 'basic',
      }),
    }));
  });

  test('attach agent', async () => {
    session.attachAgent(true);

    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      environment: expect.objectContaining({
        agent: true,
      }),
    }));
  });

  test('counters can be attached, only to the next event', async () => {
    // WHEN
    session.attachCountersToNextEvent({
      speed: 20,
    });
    await session.emit({
      eventType: 'SYNTH',
      duration: 1234,
      counters: {
        amount: 1,
      },
    });
    await session.emit({
      eventType: 'DEPLOY',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        eventType: 'SYNTH',
      }),
      counters: expect.objectContaining({
        amount: 1,
        speed: 20,
      }),
    }));

    expect(clientEmitSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        eventType: 'DEPLOY',
      }),
      counters: expect.objectContaining({
        speed: 20,
      }),
    }));
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

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      environment: expect.objectContaining({
        ci: true,
      }),
    }));
  }, {
    CI: 'true',

    // Our tests can run in these environments and we check for them too
    CODEBUILD_BUILD_ID: undefined,
    GITHUB_ACTION: undefined,
  });
});

test('ci is recorded properly - false', async () => {
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

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      environment: expect.objectContaining({
        ci: false,
      }),
    }));
  }, {
    CI: 'false',

    // Our tests can run in these environments and we check for them too
    CODEBUILD_BUILD_ID: undefined,
    GITHUB_ACTION: undefined,
  });
});

test('CDK_CLI_USERAGENT is included in config when valid (sandbox)', async () => {
  await withEnv(async () => {
    // GIVEN
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });
    clientEmitSpy = jest.spyOn(client, 'emit');
    const wrapperSession = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await wrapperSession.begin();

    // WHEN
    await wrapperSession.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        command: expect.objectContaining({
          config: expect.objectContaining({
            cdkCliUserAgent: { 'aws-blocks/1.2.3/sandbox': true },
          }),
        }),
      }),
    }));
  }, {
    CDK_CLI_USERAGENT: 'aws-blocks/1.2.3/sandbox',
  });
});

test('CDK_CLI_USERAGENT is included in config when valid (production)', async () => {
  await withEnv(async () => {
    // GIVEN
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });
    clientEmitSpy = jest.spyOn(client, 'emit');
    const wrapperSession = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await wrapperSession.begin();

    // WHEN
    await wrapperSession.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        command: expect.objectContaining({
          config: expect.objectContaining({
            cdkCliUserAgent: { 'aws-blocks/0.10.3/production': true },
          }),
        }),
      }),
    }));
  }, {
    CDK_CLI_USERAGENT: 'aws-blocks/0.10.3/production',
  });
});

test('CDK_CLI_USERAGENT is not included in config when not set', async () => {
  await withEnv(async () => {
    // GIVEN
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });
    clientEmitSpy = jest.spyOn(client, 'emit');
    const wrapperSession = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await wrapperSession.begin();

    // WHEN
    await wrapperSession.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        command: expect.objectContaining({
          config: expect.not.objectContaining({
            cdkCliUserAgent: expect.anything(),
          }),
        }),
      }),
    }));
  }, {
    CDK_CLI_USERAGENT: undefined,
  });
});

test('CDK_CLI_USERAGENT is excluded when prefix is not aws-blocks', async () => {
  await withEnv(async () => {
    // GIVEN
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });
    clientEmitSpy = jest.spyOn(client, 'emit');
    const wrapperSession = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await wrapperSession.begin();

    // WHEN
    await wrapperSession.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        command: expect.objectContaining({
          config: expect.not.objectContaining({
            cdkCliUserAgent: expect.anything(),
          }),
        }),
      }),
    }));
  }, {
    CDK_CLI_USERAGENT: 'projen/1.0.0/sandbox',
  });
});

test('CDK_CLI_USERAGENT is excluded when mode is invalid', async () => {
  await withEnv(async () => {
    // GIVEN
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });
    clientEmitSpy = jest.spyOn(client, 'emit');
    const wrapperSession = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await wrapperSession.begin();

    // WHEN
    await wrapperSession.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        command: expect.objectContaining({
          config: expect.not.objectContaining({
            cdkCliUserAgent: expect.anything(),
          }),
        }),
      }),
    }));
  }, {
    CDK_CLI_USERAGENT: 'aws-blocks/1.2.3/dev',
  });
});

test('CDK_CLI_USERAGENT is excluded when format is incomplete', async () => {
  await withEnv(async () => {
    // GIVEN
    ioHost = CliIoHost.instance({
      logLevel: 'trace',
    });

    const client = new IoHostTelemetrySink({ ioHost });
    clientEmitSpy = jest.spyOn(client, 'emit');
    const wrapperSession = new TelemetrySession({
      ioHost,
      client,
      arguments: { _: ['deploy'], STACKS: ['MyStack'] },
      context: new Context(),
    });
    await wrapperSession.begin();

    // WHEN
    await wrapperSession.emit({
      eventType: 'SYNTH',
      duration: 1234,
    });

    // THEN
    expect(clientEmitSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        command: expect.objectContaining({
          config: expect.not.objectContaining({
            cdkCliUserAgent: expect.anything(),
          }),
        }),
      }),
    }));
  }, {
    CDK_CLI_USERAGENT: 'aws-blocks/1.2.3',
  });
});

describe('isValidWrapperUserAgent', () => {
  test.each([
    ['aws-blocks/1.2.3/sandbox', true],
    ['aws-blocks/0.10.3/production', true],
    ['aws-blocks/0.0.1/sandbox', true],
  ])('valid: %s → %s', (value, expected) => {
    expect(isValidWrapperUserAgent(value)).toBe(expected);
  });

  test.each([
    [undefined, false],
    ['', false],
    ['projen/1.0.0/sandbox', false],
    ['aws-blocks', false],
    ['aws-blocks/1.2.3', false],
    ['aws-blocks/1.2.3/dev', false],
    ['aws-blocks/1.2.3/staging', false],
    ['aws-blocks/1.2.3/sandbox/extra', false],
    ['AWS-BLOCKS/1.0.0/sandbox', false],
  ])('invalid: %s → %s', (value, expected) => {
    expect(isValidWrapperUserAgent(value)).toBe(expected);
  });
});
