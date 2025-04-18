import { promises as fs } from 'fs';
import * as path from 'path';
import { DescribeStacksCommand, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture, randomString } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'test resource import',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const randomPrefix = randomString();
    const uniqueOutputsFileName = `${randomPrefix}Outputs.json`; // other tests use the outputs file. Make sure we don't collide.
    const outputsFile = path.join(fixture.integTestDir, 'outputs', uniqueOutputsFileName);
    await fs.mkdir(path.dirname(outputsFile), { recursive: true });

    // First, create a stack that includes many queues, and one queue that will be removed from the stack but NOT deleted from AWS.
    await fixture.cdkDeploy('importable-stack', {
      modEnv: { LARGE_TEMPLATE: '1', INCLUDE_SINGLE_QUEUE: '1', RETAIN_SINGLE_QUEUE: '1' },
      options: ['--outputs-file', outputsFile],
    });

    try {
      // Second, now the queue we will remove is in the stack and has a logicalId. We can now make the resource mapping file.
      // This resource mapping file will be used to tell the import operation what queue to bring into the stack.
      const fullStackName = fixture.fullStackName('importable-stack');
      const outputs = JSON.parse((await fs.readFile(outputsFile, { encoding: 'utf-8' })).toString());
      const queueLogicalId = outputs[fullStackName].QueueLogicalId;
      const queueResourceMap = {
        [queueLogicalId]: { QueueUrl: outputs[fullStackName].QueueUrl },
      };
      const mappingFile = path.join(fixture.integTestDir, 'outputs', `${randomPrefix}Mapping.json`);
      await fs.writeFile(mappingFile, JSON.stringify(queueResourceMap), { encoding: 'utf-8' });

      // Third, remove the queue from the stack, but don't delete the queue from AWS.
      await fixture.cdkDeploy('importable-stack', {
        modEnv: { LARGE_TEMPLATE: '1', INCLUDE_SINGLE_QUEUE: '0', RETAIN_SINGLE_QUEUE: '0' },
      });
      const cfnTemplateBeforeImport = await fixture.aws.cloudFormation.send(
        new GetTemplateCommand({ StackName: fullStackName }),
      );
      expect(cfnTemplateBeforeImport.TemplateBody).not.toContain(queueLogicalId);

      // WHEN
      await fixture.cdk(['import', '--resource-mapping', mappingFile, fixture.fullStackName('importable-stack')], {
        modEnv: { LARGE_TEMPLATE: '1', INCLUDE_SINGLE_QUEUE: '1', RETAIN_SINGLE_QUEUE: '0' },
      });

      // THEN
      const describeStacksResponse = await fixture.aws.cloudFormation.send(
        new DescribeStacksCommand({ StackName: fullStackName }),
      );
      const cfnTemplateAfterImport = await fixture.aws.cloudFormation.send(
        new GetTemplateCommand({ StackName: fullStackName }),
      );
      expect(describeStacksResponse.Stacks![0].StackStatus).toEqual('IMPORT_COMPLETE');
      expect(cfnTemplateAfterImport.TemplateBody).toContain(queueLogicalId);
    } finally {
      // Clean up
      await fixture.cdkDestroy('importable-stack');
    }
  }),
);

