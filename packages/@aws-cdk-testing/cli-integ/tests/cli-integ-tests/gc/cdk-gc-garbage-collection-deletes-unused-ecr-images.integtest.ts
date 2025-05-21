import { ListImagesCommand } from '@aws-sdk/client-ecr';
import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'Garbage Collection deletes unused ecr images',
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

    await fixture.cdkDestroy('docker-in-use', {
      options: [
        '--context', `@aws-cdk/core:bootstrapQualifier=${fixture.qualifier}`,
        '--toolkit-stack-name', toolkitStackName,
        '--force',
      ],
    });

    await fixture.cdkGarbageCollect({
      rollbackBufferDays: 0,
      type: 'ecr',
      bootstrapStackName: toolkitStackName,
    });
    fixture.log('Garbage collection complete!');

    // assert that the bootstrap repository is empty
    await fixture.aws.ecr.send(new ListImagesCommand({ repositoryName: repoName }))
      .then((result) => {
        expect(result.imageIds).toEqual([]);
      });
  }),
);

