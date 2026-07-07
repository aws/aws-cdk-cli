import { startCdkExplore } from '@aws-cdk/cdk-explorer';
import type { IoHelper } from '../api-private';

export interface ExploreOptions {
  readonly ioHelper: IoHelper;
  readonly port?: number;
}

export async function explore(options: ExploreOptions): Promise<number> {
  const server = await startCdkExplore({
    port: options.port,
    onWatcherError: (err) => void options.ioHelper.defaults.error(
      `CDK Explorer live refresh stopped: ${err instanceof Error ? err.message : String(err)}`,
    ),
  });
  await options.ioHelper.defaults.info(`CDK Explorer running at ${server.url}`);

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
