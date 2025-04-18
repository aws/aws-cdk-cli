/**
 * Tests for the standalone cdk-assets executable, as used by CDK Pipelines
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk-assets smoke test',
  withDefaultFixture(async (fixture) => {
    await fixture.shell(['npm', 'init', '-y']);
    await fixture.shell(['npm', 'install', 'cdk-assets@latest']);

    const account = await fixture.aws.account();
    const region = fixture.aws.region;
    const bucketName = `cdk-hnb659fds-assets-${account}-${region}`;
    const repositoryName = `cdk-hnb659fds-container-assets-${account}-${region}`;

    const imageDir = 'imagedir';
    await fs.mkdir(path.join(fixture.integTestDir, imageDir), { recursive: true });

    // Write an asset file and a data file for the Docker image
    const assetFile = 'testfile.txt';
    for (const toCreate of [assetFile, `${imageDir}/datafile.txt`]) {
      await fs.writeFile(path.join(fixture.integTestDir, toCreate), 'some asset file');
    }

    // Write a Dockerfile for the image build with a data file in it
    await fs.writeFile(path.join(fixture.integTestDir, imageDir, 'Dockerfile'), [
      'FROM scratch',
      'ADD datafile.txt datafile.txt',
    ].join('\n'));

    // Write an asset JSON file to publish to the bootstrapped environment
    const assetsJson = {
      version: '38.0.1',
      files: {
        testfile: {
          source: {
            path: assetFile,
            packaging: 'file',
          },
          destinations: {
            current: {
              region,
              assumeRoleArn: `arn:\${AWS::Partition}:iam::${account}:role/cdk-hnb659fds-file-publishing-role-${account}-${region}`,
              bucketName,
              objectKey: `test-file-${Date.now()}.json`,
            },
          },
        },
      },
      dockerImages: {
        testimage: {
          source: {
            directory: imageDir,
          },
          destinations: {
            current: {
              region,
              assumeRoleArn: `arn:\${AWS::Partition}:iam::${account}:role/cdk-hnb659fds-image-publishing-role-${account}-${region}`,
              repositoryName,
              imageTag: 'test-image', // Not fresh on every run because we'll run out of tags too easily
            },
          },
        },
      },
    };

    await fs.writeFile(path.join(fixture.integTestDir, 'assets.json'), JSON.stringify(assetsJson, undefined, 2));
    await fixture.shell(['npx', 'cdk-assets', '--path', 'assets.json', '--verbose', 'publish'], {
      modEnv: {
        ...fixture.cdkShellEnv(),
        // This is necessary for cdk-assets v2, if the credentials are supplied via
        // config file (which they are on the CodeBuild canaries).
        AWS_SDK_LOAD_CONFIG: '1',
      },
    });
  }),
);
