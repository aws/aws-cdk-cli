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
    expect(tableName).toBeDefined();

    try {
      // Verify the table resource exists in the template before orphaning
      const templateBefore = await fixture.aws.cloudFormation.send(
        new GetTemplateCommand({ StackName: stackName }),
      );
      const templateBodyBefore = yaml.parse(templateBefore.TemplateBody!);
      expect(templateBodyBefore.Resources).toHaveProperty('MyTable794EDED1');

      // Put an item in the table before orphan
      await fixture.aws.dynamoDb.putItem({
        TableName: tableName!,
        Item: { PK: { S: 'before-orphan' } },
      });

      // Orphan the table
      const orphanOutput = await fixture.cdk([
        'orphan',
        `${stackName}/MyTable`,
        '--unstable=orphan',
        '--yes',
      ]);

      // Verify the output contains a resource mapping for import
      expect(orphanOutput).toContain('resource-mapping-inline');
      expect(orphanOutput).toContain('TableName');

      // Verify the template after orphan: table gone, Lambda env vars replaced with literals
      const templateAfter = await fixture.aws.cloudFormation.send(
        new GetTemplateCommand({ StackName: stackName }),
      );
      const templateBody = yaml.parse(templateAfter.TemplateBody!);

      expect(templateBody.Resources).not.toHaveProperty('MyTable794EDED1');
      expect(templateBody).toMatchObject({
        Resources: expect.objectContaining({
          Consumer8D6BE417: expect.objectContaining({
            Type: 'AWS::Lambda::Function',
            Properties: expect.objectContaining({
              Environment: {
                Variables: {
                  TABLE_NAME: expect.stringContaining('MyTable'),
                  TABLE_ARN: expect.stringContaining('arn:aws:dynamodb'),
                },
              },
            }),
          }),
        }),
      });

      // Verify the table still exists and data is intact (strongly consistent read)
      const getItemResult = await fixture.aws.dynamoDb.getItem({
        TableName: tableName!,
        Key: { PK: { S: 'before-orphan' } },
        ConsistentRead: true,
      });
      expect(getItemResult.Item?.PK?.S).toBe('before-orphan');
    } finally {
      // Clean up the retained table to avoid leaking resources
      try {
        await fixture.aws.dynamoDb.deleteTable({ TableName: tableName! });
      } catch (e) {
        // Ignore
      }
    }
  }),
);
