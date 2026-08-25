import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --json-file writes diff document and keeps human output',
  withDefaultFixture(async (fixture) => {
    // GIVEN: an undeployed stack containing an IAM role
    const stackName = fixture.fullStackName('iam-test');
    const jsonFile = path.join(fixture.integTestDir, 'diff.json');

    // WHEN
    const diff = await fixture.cdk(['diff', `--json-file=${jsonFile}`, stackName]);

    // THEN: the human-readable diff is still printed
    expect(diff).toContain(`Stack ${stackName}`);
    expect(diff).toContain('IAM Statement Changes');

    // AND the file contains the machine-readable diff
    const doc = JSON.parse(await fs.readFile(jsonFile, { encoding: 'utf-8' }));
    const templateDiff = doc[stackName][stackName];
    expect(templateDiff.permissionsBroadened).toBe(true);

    // The new role must show up both as a resource change and as an IAM statement addition
    const resourceChanges: any[] = Object.values(templateDiff.resources);
    expect(resourceChanges).toContainEqual(expect.objectContaining({
      newResourceType: 'AWS::IAM::Role',
      isAddition: true,
      changeImpact: 'WILL_CREATE',
    }));
    expect(templateDiff.iamChanges.statementAdditions).toContainEqual({
      type: 'parsed',
      value: expect.objectContaining({
        effect: 'Allow',
        actions: { not: false, values: ['sts:AssumeRole'] },
      }),
    });
  }),
);
