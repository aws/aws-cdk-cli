
import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture, withRetry } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('cdk-assets uses profile when specified', 
  withRetry(withDefaultFixture(async (fixture) => {
    const currentCreds = await fixture.aws.credentials();

    await fixture.cdkAssets.makeCliAvailable();

    const account = await fixture.aws.account();
    const region = fixture.aws.region;
    const bucketName = `cdk-hnb659fds-assets-${account}-${region}`;

    // Write some asset files. Its important to have more than 1 because cdk-assets
    // code has some funky state mutations that happens on each asset publishing.
    const assetFile1 = 'testfile.txt';
    const assetFile2 = 'testfile.txt';
    await fs.writeFile(path.join(fixture.integTestDir, assetFile1), 'some asset file');
    await fs.writeFile(path.join(fixture.integTestDir, assetFile2), 'some asset file');

    // Write an asset JSON file to publish to the bootstrapped environment
    const assetsJson = {
      version: '38.0.1',
      files: {
        testfile1: {
          source: {
            path: assetFile1,
            packaging: 'file',
          },
          destinations: {
            current: {
              region,
              assumeRoleArn: `arn:\${AWS::Partition}:iam::${account}:role/cdk-hnb659fds-file-publishing-role-${account}-${region}`,
              bucketName,
              objectKey: `test-file1-${Date.now()}.json`,
            },
          },
        },
        testfile2: {
          source: {
            path: assetFile2,
            packaging: 'file',
          },
          destinations: {
            current: {
              region,
              assumeRoleArn: `arn:\${AWS::Partition}:iam::${account}:role/cdk-hnb659fds-file-publishing-role-${account}-${region}`,
              bucketName,
              objectKey: `test-file2-${Date.now()}.json`,
            },
          },
        },
      },
    };

    // create a profile with our current credentials.
    //
    // if you're wondering why can't we do the reverse (i.e write a bogus profile and assert a failure),
    // its because when cdk-assets discovers the current account, it DOES consider the profile.
    // writing a bogus profile would fail this operation and we won't be able to reach the code
    // we're trying to test.
    const credentialsFile = path.join(fixture.integTestDir, 'aws.credentials');
    const profile = 'cdk-assets';

    // this kind sucks but its what it is given we need to write a working profile
    await fs.writeFile(credentialsFile, `[${profile}]
  aws_access_key_id=${currentCreds.accessKeyId}
  aws_secret_access_key=${currentCreds.secretAccessKey}
  aws_session_token=${currentCreds.sessionToken}`);

    await fs.writeFile(path.join(fixture.integTestDir, 'assets.json'), JSON.stringify(assetsJson, undefined, 2));
    await fixture.shell(['cdk-assets', '--path', 'assets.json', 'publish', '--profile', profile], {
      modEnv: {
        ...fixture.cdkShellEnv(),
        AWS_SHARED_CREDENTIALS_FILE: credentialsFile,

        // remove the default creds so that if the command doesn't use
        // the profile, it will fail with "Could not load credentials from any providers"
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '',
        AWS_SESSION_TOKEN: '',

      },
    });
  })),
);
