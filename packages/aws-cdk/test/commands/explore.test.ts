import { explore } from '../../lib/commands/explore';
import { startWebServer } from '../../lib/private/explorer';

/**
 * `startWebServer` is wrapped, it runs for real by default, so the end-to-end
 * test below exercises a live server. The option-forwarding tests swap in a
 * stub that records what the command passed without binding a port or starting
 * watchers.
 */
jest.mock('../../lib/private/explorer', () => {
  const actual = jest.requireActual('../../lib/private/explorer');
  return { ...actual, startWebServer: jest.fn(actual.startWebServer) };
});

const mockStartWebServer = startWebServer as jest.MockedFunction<typeof startWebServer>;
const realStartWebServer: typeof startWebServer =
  jest.requireActual('../../lib/private/explorer').startWebServer;

type ServerOptions = Parameters<typeof startWebServer>[0];

describe('explore command', () => {
  beforeEach(() => {
    mockStartWebServer.mockReset();
    mockStartWebServer.mockImplementation(realStartWebServer);
  });

  test('starts server and prints URL', async () => {
    const messages: string[] = [];
    const fakeIoHelper = {
      defaults: {
        info: async (msg: string) => {
          messages.push(msg);
        },
      },
    };

    // Run explore in background, then immediately send SIGINT to unblock it
    const resultPromise = explore({ ioHelper: fakeIoHelper as any });

    // Give the server time to start, then signal exit
    await new Promise((r) => setTimeout(r, 100));
    process.emit('SIGINT', 'SIGINT');

    const exitCode = await resultPromise;

    expect(exitCode).toBe(0);
    expect(messages).toHaveLength(1);
    // The printed URL must carry the session token; without it the link is refused,
    // and it is the only way into this session.
    expect(messages[0]).toMatch(/CDK Explorer running at http:\/\/localhost:\d+\/\?token=[\w-]{20,}/);
  });

  describe('assembly output directory', () => {
    const messages: string[] = [];
    const fakeIoHelper = {
      defaults: {
        info: async (msg: string) => {
          messages.push(msg);
        },
        error: async (msg: string) => {
          messages.push(msg);
        },
      },
    } as any;

    /** Replaces the real server with a stub and returns the options it was handed. */
    function captureServerOptions(): () => ServerOptions {
      let captured: ServerOptions | undefined;
      mockStartWebServer.mockImplementation(async (options) => {
        captured = options;
        return {
          url: 'http://localhost:4321',
          sessionUrl: 'http://localhost:4321/?token=fake-token',
          token: 'fake-token',
          stop: async () => undefined,
        };
      });
      return () => {
        if (!captured) throw new Error('startWebServer was never called');
        return captured;
      };
    }

    /**
     * `explore` blocks until a signal arrives, so every test has to unblock it.
     * The handlers are registered before that await, so emitting on a later tick
     * is enough.
     */
    async function runExplore(options: Parameters<typeof explore>[0]): Promise<number> {
      const resultPromise = explore(options);
      await new Promise((r) => setTimeout(r, 10));
      process.emit('SIGINT', 'SIGINT');
      return resultPromise;
    }

    let serverOptions: () => ServerOptions;

    beforeEach(() => {
      messages.length = 0;
      serverOptions = captureServerOptions();
    });

    test('forwards the output option as the assembly directory', async () => {
      const exitCode = await runExplore({ ioHelper: fakeIoHelper, output: 'dist/assembly' });

      expect(exitCode).toBe(0);
      expect(serverOptions().assemblyDir).toBe('dist/assembly');
    });

    test('forwards an absolute output option unchanged', async () => {
      await runExplore({ ioHelper: fakeIoHelper, output: '/tmp/explorer-assembly' });

      expect(serverOptions().assemblyDir).toBe('/tmp/explorer-assembly');
    });

    test('leaves the assembly directory unset when no output is given, so the server picks the default', async () => {
      await runExplore({ ioHelper: fakeIoHelper });

      expect(serverOptions().assemblyDir).toBeUndefined();
    });

    test('forwards the port and the output independently', async () => {
      await runExplore({ ioHelper: fakeIoHelper, port: 4400, output: 'dist/assembly' });

      expect(serverOptions()).toMatchObject({ port: 4400, assemblyDir: 'dist/assembly' });
    });

    test('routes watcher errors to the IoHost', async () => {
      await runExplore({ ioHelper: fakeIoHelper, output: 'dist/assembly' });

      serverOptions().onWatcherError!(new Error('inotify limit reached'));

      expect(messages).toContain('CDK Explorer live refresh stopped: inotify limit reached');
    });
  });
});
