import { startWebServer } from '@aws-cdk/cdk-explorer';
import type { IoHelper } from '../api-private';

export interface ExploreOptions {
  readonly ioHelper: IoHelper;
  readonly port?: number;
}

export async function explore(options: ExploreOptions): Promise<number> {
  const server = await startWebServer({ port: options.port });
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
