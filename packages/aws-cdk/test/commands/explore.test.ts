import { explore } from '../../lib/commands/explore';

describe('explore command', () => {
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
    expect(messages[0]).toMatch(/CDK Explorer running at http:\/\/127\.0\.0\.1:\d+/);
  });
});
