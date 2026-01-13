import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { StackResource } from '@aws-sdk/client-cloudformation';
import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk refactor - detects refactoring changes and executes the refactor, overriding ambiguities',
  withSpecificFixture('refactoring', async (fixture) => {
    // First, deploy the stacks
    await fixture.cdkDeploy('bucket-stack');
    const stackArn = await fixture.cdkDeploy('basic', {
      modEnv: {
        BASIC_QUEUE_LOGICAL_ID: 'OldName',
        ADDITIONAL_QUEUE_LOGICAL_ID: 'AdditionalOldName',
      },
    });

    const stackInfo = getStackInfoFromArn(stackArn);
    const stackName = stackInfo.name;

    const overrides = {
      environments: [
        {
          account: stackInfo.account,
          region: stackInfo.region,
          resources: {
            [`${stackName}/OldName/Resource`]: `${stackName}/NewName/Resource`,
            [`${stackName}/AdditionalOldName/Resource`]: `${stackName}/AdditionalNewName/Resource`,
          },
        },
      ],
    };

    const overridesPath = path.join(os.tmpdir(), `overrides-${Date.now()}.json`);
    fs.writeFileSync(overridesPath, JSON.stringify(overrides));

    // Then see if the refactoring tool detects the change
    const stdErr = await fixture.cdkRefactor({
      options: ['--unstable=refactor', '--force', `--override-file=${overridesPath}`],
      allowErrExit: true,
      // Making sure the synthesized stack has a queue with
      // the new name so that a refactor is detected
      modEnv: {
        BASIC_QUEUE_LOGICAL_ID: 'NewName',
        ADDITIONAL_QUEUE_LOGICAL_ID: 'AdditionalNewName',
      },
    });

    expect(stdErr).toMatch('Stack refactor complete');

    const stackDescription = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: stackName,
      }),
    );

    const resources = Object.fromEntries(
      (stackDescription.StackResources ?? []).map(
        (resource) => [resource.LogicalResourceId!, resource] as [string, StackResource],
      ),
    );

    expect(resources.AdditionalNewNameE2FC5A4C).toBeDefined();
    expect(resources.NewName57B171FE).toBeDefined();

    // CloudFormation may complete the refactoring, while the stack is still in the "UPDATE_IN_PROGRESS" state.
    // Give it a couple of seconds to finish the update.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }),
);

interface StackInfo {
  readonly account: string;
  readonly region: string;
  readonly name: string;
}

export function getStackInfoFromArn(stackArn: string): StackInfo {
  // Example ARN: arn:aws:cloudformation:region:account-id:stack/stack-name/guid
  const arnParts = stackArn.split(':');
  const resource = arnParts[5]; // "stack/stack-name/guid"
  const resourceParts = resource.split('/');
  // The stack name is the second part: ["stack", "stack-name", "guid"]
  return {
    region: arnParts[3],
    account: arnParts[4],
    name: resourceParts[1],
  };
}
