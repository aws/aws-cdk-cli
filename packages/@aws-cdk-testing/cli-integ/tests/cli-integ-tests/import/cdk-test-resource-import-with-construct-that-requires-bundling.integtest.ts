import { promises as fs } from 'fs';
import * as path from 'path';
import { DescribeStacksCommand, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'test resource import with construct that requires bundling',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const outputsFile = path.join(fixture.integTestDir, 'outputs', 'outputs.json');
    await fs.mkdir(path.dirname(outputsFile), { recursive: true });

    // First, create a stack that includes a NodeJSFunction lambda and one bucket that will be removed from the stack but NOT deleted from AWS.
    await fixture.cdkDeploy('importable-stack', {
      modEnv: { INCLUDE_NODEJS_FUNCTION_LAMBDA: '1', INCLUDE_SINGLE_BUCKET: '1', RETAIN_SINGLE_BUCKET: '1' },
      options: ['--outputs-file', outputsFile],
    });

    try {
      // Second, now the bucket we will remove is in the stack and has a logicalId. We can now make the resource mapping file.
      // This resource mapping file will be used to tell the import operation what bucket to bring into the stack.
      const fullStackName = fixture.fullStackName('importable-stack');
      const outputs = JSON.parse((await fs.readFile(outputsFile, { encoding: 'utf-8' })).toString());
      const bucketLogicalId = outputs[fullStackName].BucketLogicalId;
      const bucketName = outputs[fullStackName].BucketName;
      const bucketResourceMap = {
        [bucketLogicalId]: {
          BucketName: bucketName,
        },
      };
      const mappingFile = path.join(fixture.integTestDir, 'outputs', 'mapping.json');
      await fs.writeFile(mappingFile, JSON.stringify(bucketResourceMap), { encoding: 'utf-8' });

      // Third, remove the bucket from the stack, but don't delete the bucket from AWS.
      await fixture.cdkDeploy('importable-stack', {
        modEnv: { INCLUDE_NODEJS_FUNCTION_LAMBDA: '1', INCLUDE_SINGLE_BUCKET: '0', RETAIN_SINGLE_BUCKET: '0' },
      });
      const cfnTemplateBeforeImport = await fixture.aws.cloudFormation.send(
        new GetTemplateCommand({ StackName: fullStackName }),
      );
      expect(cfnTemplateBeforeImport.TemplateBody).not.toContain(bucketLogicalId);

      // WHEN
      await fixture.cdk(['import', '--resource-mapping', mappingFile, fixture.fullStackName('importable-stack')], {
        modEnv: { INCLUDE_NODEJS_FUNCTION_LAMBDA: '1', INCLUDE_SINGLE_BUCKET: '1', RETAIN_SINGLE_BUCKET: '0' },
      });

      // THEN
      const describeStacksResponse = await fixture.aws.cloudFormation.send(
        new DescribeStacksCommand({ StackName: fullStackName }),
      );
      const cfnTemplateAfterImport = await fixture.aws.cloudFormation.send(
        new GetTemplateCommand({ StackName: fullStackName }),
      );

      // If bundling is skipped during import for NodeJSFunction lambda, then the operation should fail and exit
      expect(describeStacksResponse.Stacks![0].StackStatus).toEqual('IMPORT_COMPLETE');

      // If the import operation is successful, the template should contain the imported bucket
      expect(cfnTemplateAfterImport.TemplateBody).toContain(bucketLogicalId);
    } finally {
      // Clean up the resources we created
      await fixture.cdkDestroy('importable-stack');
    }
  }),
);

/**
 * Create a queue, orphan that queue, then import the queue.
 *
 * We want to test with a large template to make sure large templates can work with import.
 */
