import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';
import { awsActionsFromRequests, startProxyServer } from '../../../lib/proxy';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('requests go through a proxy when configured',
  withDefaultFixture(async (fixture) => {
    const proxyServer = await startProxyServer();
    try {
      // Matches CDK_HOME below.
      const cdkCacheDir = path.join(fixture.integTestDir, 'cache');
      // Delete notices cache if it exists
      await fs.rm(path.join(cdkCacheDir, 'notices.json'), { force: true });

      // Delete connection cache if it exists
      await fs.rm(path.join(cdkCacheDir, 'connection.json'), { force: true });

      await fixture.cdkDeploy('test-2', {
        captureStderr: true,
        options: [
          '--proxy', proxyServer.url,
          '--ca-bundle-path', proxyServer.certPath,
        ],
        modEnv: {
          CDK_HOME: fixture.integTestDir,
        },
      });

      const connections = JSON.stringify(await fs.readFile(path.join(cdkCacheDir, 'connection.json')));
      // eslint-disable-next-line no-console
      console.log(connections);

      const requests = await proxyServer.getSeenRequests();
      const urls = requests.map(req => req.url);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(urls));
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(urls.reverse()));

      const urls2 = urls.filter(u => u.startsWith('https://cli.cdk.dev'));
      // eslint-disable-next-line no-console
      console.log(urls2);

      expect(urls)
        .toContain('https://cli.cdk.dev-tools.aws.dev/notices.json');

      const actionsUsed = awsActionsFromRequests(requests);
      expect(actionsUsed).toContain('AssumeRole');
      expect(actionsUsed).toContain('CreateChangeSet');
    } finally {
      await proxyServer.stop();
    }
  }),
);
