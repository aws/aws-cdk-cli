/**
 * Tests for the standalone cdk-assets executable, as used by CDK Pipelines
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { writeDockerAsset } from './asset_helpers';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk-assets can use Docker credentials helper',
  withDefaultFixture(async (fixture) => {
    await fixture.shell(['npm', 'init', '-y']);
    await fixture.shell(['npm', 'install', 'cdk-assets@latest']);

    const account = await fixture.aws.account();
    const region = fixture.aws.region;
    const repositoryName = `cdk-hnb659fds-container-assets-${account}-${region}`;

    const imageAsset = await writeDockerAsset(fixture);

    // Write an asset JSON file to publish to the bootstrapped environment
    const assetsJson = {
      version: '38.0.1',
      dockerImages: {
        testimage: {
          source: {
            directory: imageAsset.relativeImageDir,
          },
          destinations: {
            current: {
              // No assumeRoleArn here, because we will use the Docker credentials helper.
              // Without using the helper, this will fail.
              region,
              repositoryName,
              imageTag: 'test-image2', // Not fresh on every run because we'll run out of tags too easily
            },
          },
        },
      },
    };

    // Write a config file for `cdk-assets` to use the Docker credentials helper.
    // In this case, we will do the same as what `cdk-assets` would have done by itself.
    const cdkAssetsConfigFile = path.join(fixture.integTestDir, 'cdk-docker-creds.json');
    await fs.writeFile(cdkAssetsConfigFile, JSON.stringify({
      version: '1.0',
      domainCredentials: {
        [imageAsset.repositoryDomain]: {
          ecrRepository: true,
          assumeRoleArn: imageAsset.assumeRoleArn,
        },
      },
    }, undefined, 2), 'utf-8');

    await fs.writeFile(path.join(fixture.integTestDir, 'assets.json'), JSON.stringify(assetsJson, undefined, 2));

    await fixture.shell([process.env.CDK_DOCKER ?? 'docker', 'logout', imageAsset.repositoryDomain]);
    await fixture.shell(['npx', 'cdk-assets', '--path', 'assets.json', '--verbose', 'publish'], {
      modEnv: {
        ...fixture.cdkShellEnv(),

        // By default `cdk-assets` will look in $HOME/.cdk/cdk-docker-creds.json, but
        // we force it to use a file in the temporary dir.
        // FIXME: Temporarily not, to confirm that tests fail
        // CDK_DOCKER_CREDS_FILE: cdkAssetsConfigFile,
      },
    });
  }),
);

