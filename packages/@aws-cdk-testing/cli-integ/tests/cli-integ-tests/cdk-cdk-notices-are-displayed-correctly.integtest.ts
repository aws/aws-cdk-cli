import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('cdk notices are displayed correctly', withDefaultFixture(async (fixture) => {
  const cache = {
    expiration: 4125963264000, // year 2100 so we never overwrite the cache
    notices: [
      {
        title: 'Bootstrap 1999 Notice',
        issueNumber: 4444,
        overview: 'Overview for Bootstrap 1999 Notice. AffectedEnvironments:<{resolve:ENVIRONMENTS}>',
        components: [
          {
            name: 'bootstrap',
            version: '<1999', // so we include all possible environments
          },
        ],
        schemaVersion: '1',
      },
    ],
  };

  const cdkCacheDir = path.join(fixture.integTestDir, 'cache');
  await fs.mkdir(cdkCacheDir);
  await fs.writeFile(path.join(cdkCacheDir, 'notices.json'), JSON.stringify(cache));

  const output = await fixture.cdkDeploy('notices', {
    verbose: false,
    modEnv: {
      CDK_HOME: fixture.integTestDir,
    },
  });

  expect(output).toContain('Overview for Bootstrap 1999 Notice');

  // assert dynamic environments are resolved
  expect(output).toContain(`AffectedEnvironments:<aws://${await fixture.aws.account()}/${fixture.aws.region}>`);
}));

