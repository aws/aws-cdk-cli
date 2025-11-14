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

      const requests = await proxyServer.getSeenRequests();
      expect(requests.map(req => req.url))
        .toContain('https://cli.cdk.dev-tools.aws.dev/notices.json');

      const actionsUsed = awsActionsFromRequests(requests);
      expect(actionsUsed).toContain('AssumeRole');
      expect(actionsUsed).toContain('CreateChangeSet');
    } finally {
      await proxyServer.stop();
    }
  }),
);
