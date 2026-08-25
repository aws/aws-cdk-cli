import type { IoHelper } from '../api-private';
import { startWebServer } from '../private/explorer';

export interface ExploreOptions {
  readonly ioHelper: IoHelper;
  readonly port?: number;
}

export async function explore(options: ExploreOptions): Promise<number> {
  const server = await startWebServer({
    port: options.port,
    onWatcherError: (err) => void options.ioHelper.defaults.error(
      `CDK Explorer live refresh stopped: ${err instanceof Error ? err.message : String(err)}`,
    ),
  });
  // sessionUrl, not url: the token in it is what authenticates the browser, and it
  // is regenerated every run, so this link is the only way in to this session.
  await options.ioHelper.defaults.info(`CDK Explorer running at ${server.sessionUrl}`);

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      resolve();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });

  await server.stop();
  return 0;
}
