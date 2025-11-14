/**
 * Tests for the standalone cdk-assets executable, as used by CDK Pipelines
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { writeDockerAsset, writeFileAsset } from './asset_helpers';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk-assets smoke test',
  withDefaultFixture(async (fixture) => {
    await fixture.shell(['npm', 'init', '-y']);
    await fixture.shell(['npm', 'install', 'cdk-assets@latest']);

    const region = fixture.aws.region;

    const fileAsset = await writeFileAsset(fixture);
    const imageAsset = await writeDockerAsset(fixture);

    // Write an asset JSON file to publish to the bootstrapped environment
    const assetsJson = {
      version: '38.0.1',
      files: {
        testfile: {
          source: {
            path: fileAsset.relativeAssetFile,
            packaging: 'file',
          },
          destinations: {
            current: {
              region,
              assumeRoleArn: fileAsset.assumeRoleArn,
              bucketName: fileAsset.bucketName,
              objectKey: `test-file-${Date.now()}.json`,
            },
          },
        },
      },
      dockerImages: {
        testimage: {
          source: {
            directory: imageAsset.relativeImageDir,
          },
          destinations: {
            current: {
              region,
              assumeRoleArn: imageAsset.assumeRoleArn,
              repositoryName: imageAsset.repositoryName,
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
      },
    });
  }),
);
