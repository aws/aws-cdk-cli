import { promises as fs } from 'fs';
import * as path from 'path';
import { DescribeStacksCommand, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import * as yaml from 'yaml';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk orphan detaches a resource from the stack without deleting it',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('orphanable');

    // Deploy the stack with a DynamoDB table + Lambda consumer
    await fixture.cdkDeploy('orphanable');

    // Get outputs
    const describeResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({ StackName: stackName }),
    );
    const outputs = describeResponse.Stacks?.[0]?.Outputs ?? [];
    const tableName = outputs.find((o) => o.OutputKey === 'TableName')?.OutputValue;
    const functionName = outputs.find((o) => o.OutputKey === 'FunctionName')?.OutputValue;
    expect(tableName).toBeDefined();
    expect(functionName).toBeDefined();

    // Put an item in the table before orphan
    const itemFile = path.join(fixture.integTestDir, 'test-item.json');
    await fs.writeFile(itemFile, JSON.stringify({ PK: { S: 'before-orphan' } }));
    await fixture.shell([
      'aws', 'dynamodb', 'put-item',
      '--table-name', tableName!,
      '--item', `file://${itemFile}`,
      '--region', fixture.aws.region,
    ]);

    // Orphan the table
    const orphanOutput = await fixture.cdk([
      'orphan',
      '--path', `${stackName}/MyTable`,
      '--unstable=orphan',
      '--force',
    ]);

    // Verify the output contains a resource mapping for import
    expect(orphanOutput).toContain('resource-mapping-inline');
    expect(orphanOutput).toContain('TableName');

    // Verify the table is no longer in the stack template
    const templateAfter = await fixture.aws.cloudFormation.send(
      new GetTemplateCommand({ StackName: stackName }),
    );
    const templateBody = yaml.parse(templateAfter.TemplateBody!);
    expect(templateBody.Resources).not.toHaveProperty('MyTable794EDED1');

    // Verify the Lambda still exists and its env vars have been replaced with literals
    // (Ref -> physical table name, GetAtt -> physical ARN)
    const lambdaResource = Object.values(templateBody.Resources).find(
      (r: any) => r.Type === 'AWS::Lambda::Function',
    ) as any;
    expect(lambdaResource).toBeDefined();
    const envVars = lambdaResource.Properties?.Environment?.Variables ?? {};
    // TABLE_NAME should be a literal string (not a {Ref})
    expect(typeof envVars.TABLE_NAME).toBe('string');
    expect(envVars.TABLE_NAME).toContain('MyTable');
    // TABLE_ARN should be a literal string (not a {Fn::GetAtt})
    expect(typeof envVars.TABLE_ARN).toBe('string');
    expect(envVars.TABLE_ARN).toContain('arn:aws:dynamodb');

    // Verify the table still exists and data is intact
    const getItemOutput = await fixture.shell([
      'aws', 'dynamodb', 'get-item',
      '--table-name', tableName!,
      '--key', `file://${itemFile}`,
      '--region', fixture.aws.region,
      '--output', 'json',
    ]);
    expect(getItemOutput).toContain('before-orphan');
  }),
);
