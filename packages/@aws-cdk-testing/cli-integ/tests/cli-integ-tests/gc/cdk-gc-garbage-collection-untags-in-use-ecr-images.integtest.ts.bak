import { BatchGetImageCommand, ListImagesCommand, PutImageCommand } from '@aws-sdk/client-ecr';
import { integTest, withoutBootstrap } from '../../../lib';

const ECR_ISOLATED_TAG = 'aws-cdk.isolated';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'Garbage Collection untags in-use ecr images',
  withoutBootstrap(async (fixture) => {
    const toolkitStackName = fixture.bootstrapStackName;

    await fixture.cdkBootstrapModern({
      toolkitStackName,
    });

    const repoName = await fixture.bootstrapRepoName();

    await fixture.cdkDeploy('docker-in-use', {
      options: [
        '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
        '--toolkit-stack-name', toolkitStackName,
        '--force',
      ],
    });
    fixture.log('Setup complete!');

    // Artificially add tagging to the asset in the bootstrap bucket
    const imageIds = await fixture.aws.ecr.send(new ListImagesCommand({ repositoryName: repoName }));
    const digest = imageIds.imageIds![0].imageDigest;
    const imageManifests = await fixture.aws.ecr.send(new BatchGetImageCommand({ repositoryName: repoName, imageIds: [{ imageDigest: digest }] }));
    const manifest = imageManifests.images![0].imageManifest;
    await fixture.aws.ecr.send(new PutImageCommand({ repositoryName: repoName, imageManifest: manifest, imageDigest: digest, imageTag: `0-${ECR_ISOLATED_TAG}-12345` }));

    await fixture.cdkGarbageCollect({
      rollbackBufferDays: 100, // this will ensure that we do not delete assets immediately (and just tag them)
      type: 'ecr',
      bootstrapStackName: toolkitStackName,
    });
    fixture.log('Garbage collection complete!');

    await fixture.aws.ecr.send(new ListImagesCommand({ repositoryName: repoName }))
      .then((result) => {
        expect(result.imageIds).toHaveLength(1); // the second tag has been removed
      });

    await fixture.cdkDestroy('docker-in-use', {
      options: [
        '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
        '--toolkit-stack-name', toolkitStackName,
        '--force',
      ],
    });
  }),
);
