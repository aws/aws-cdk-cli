import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'test migrate deployment for app with localfile source in migrate.json',
  withDefaultFixture(async (fixture) => {
    const outputsFile = path.join(fixture.integTestDir, 'outputs', 'outputs.json');
    await fs.mkdir(path.dirname(outputsFile), { recursive: true });

    // Initial deploy
    await fixture.cdkDeploy('migrate-stack', {
      modEnv: { ORPHAN_TOPIC: '1' },
      options: ['--outputs-file', outputsFile],
    });

    const outputs = JSON.parse((await fs.readFile(outputsFile, { encoding: 'utf-8' })).toString());
    const stackName = fixture.fullStackName('migrate-stack');
    const queueName = outputs[stackName].QueueName;
    const queueUrl = outputs[stackName].QueueUrl;
    const queueLogicalId = outputs[stackName].QueueLogicalId;
    fixture.log(`Created queue ${queueUrl} in stack ${stackName}`);

    // Write the migrate file based on the ID from step one, then deploy the app with migrate
    const migrateFile = path.join(fixture.integTestDir, 'migrate.json');
    await fs.writeFile(
      migrateFile,
      JSON.stringify({
        Source: 'localfile',
        Resources: [
          {
            ResourceType: 'AWS::SQS::Queue',
            LogicalResourceId: queueLogicalId,
            ResourceIdentifier: { QueueUrl: queueUrl },
          },
        ],
      }),
      { encoding: 'utf-8' },
    );

    await fixture.cdkDestroy('migrate-stack');
    fixture.log(`Deleted stack ${stackName}, orphaning ${queueName}`);

    // Create new stack from existing queue
    try {
      fixture.log(`Deploying new stack ${stackName}, migrating ${queueName} into stack`);
      await fixture.cdkDeploy('migrate-stack');
    } finally {
      // Cleanup
      await fixture.cdkDestroy('migrate-stack');
    }
  }),
);

