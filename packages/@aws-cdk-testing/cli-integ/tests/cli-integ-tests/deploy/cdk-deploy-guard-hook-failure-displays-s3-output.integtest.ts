import {
  SetTypeConfigurationCommand,
  DeactivateTypeCommand,
  ActivateTypeCommand,
} from '@aws-sdk/client-cloudformation';
import { CreateBucketCommand, PutBucketPolicyCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000);

integTest(
  'deploy with guard hook failure displays S3 output',
  withSpecificFixture('guard-hook-app', async (fixture) => {
    const rulesBucket = `${fixture.stackNamePrefix}-guard-rules`.toLowerCase();
    const logsBucket = `${fixture.stackNamePrefix}-guard-logs`.toLowerCase();
    const guardRuleKey = 'rules/AWS_S3_Bucket_AccessControl.guard';

    const guardRuleContent = `rule AWS_S3_Bucket_AccessControl
{
    let resources = Resources.*[ Type == "AWS::S3::Bucket" ]
    %resources[*] {
        Properties.AccessControl not exists
        <<
            AccessControl is deprecated
        >>
    }
}`;

    // Step 1: Create S3 buckets required for Guard Hook
    await fixture.aws.s3.send(new CreateBucketCommand({
      Bucket: rulesBucket,
    }));
    await fixture.aws.s3.send(new CreateBucketCommand({
      Bucket: logsBucket,
    }));

    // Step 2: Grant the CDK deploy role read access to the logs bucket via bucket policy
    // The bootstrap deploy role only has cross-account S3 permissions; same-account
    // access is granted by bucket policies, per the bootstrap template's design intent.
    const account = await fixture.aws.account();
    const deployRoleArn = `arn:aws:iam::${account}:role/cdk-hnb659fds-deploy-role-${account}-${fixture.aws.region}`;
    await fixture.aws.s3.send(new PutBucketPolicyCommand({
      Bucket: logsBucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { AWS: deployRoleArn },
          Action: ['s3:GetObject', 's3:GetObjectVersion'],
          Resource: `arn:aws:s3:::${logsBucket}/*`,
        }],
      }),
    }));

    // Step 3: Upload Guard rule to rules bucket
    await fixture.aws.s3.send(new PutObjectCommand({
      Bucket: rulesBucket,
      Key: guardRuleKey,
      Body: guardRuleContent,
    }));

    // Step 4: Create IAM role for Guard Hook execution
    const hookRoleArn = await fixture.aws.temporaryRole(
      'GuardHookExecutionRole',
      [
        {
          Effect: 'Allow',
          Principal: {
            Service: 'hooks.cloudformation.amazonaws.com',
          },
          Action: 'sts:AssumeRole',
        },
      ],
      [
        {
          Effect: 'Allow',
          Action: [
            's3:ListBucket',
            's3:GetObject',
            's3:GetObjectVersion',
          ],
          Resource: [
            `arn:aws:s3:::${rulesBucket}/*`,
            `arn:aws:s3:::${rulesBucket}`,
          ],
        },
        {
          Effect: 'Allow',
          Action: ['s3:PutObject'],
          Resource: `arn:aws:s3:::${logsBucket}/*`,
        },
      ]
    );

    // Step 5: Activate the AWS Guard Hook type in this region
    const activateResponse = await fixture.aws.cloudFormation.send(new ActivateTypeCommand({
      Type: 'HOOK',
      TypeName: 'AWS::Hooks::GuardHook',
      PublisherId: 'aws-hooks',
      TypeNameAlias: 'Private::Guard::TestHook',
      ExecutionRoleArn: hookRoleArn,
    }));
    const hookTypeArn = activateResponse.Arn!;

    // Step 6: Configure the Guard Hook
    const typeConfiguration = {
      CloudFormationConfiguration: {
        HookConfiguration: {
          HookInvocationStatus: 'ENABLED',
          TargetOperations: ['RESOURCE'],
          FailureMode: 'FAIL',
          Properties: {
            ruleLocation: { uri: `s3://${rulesBucket}/${guardRuleKey}` },
            logBucket: logsBucket,
          },
          TargetFilters: {
            Actions: ['CREATE', 'UPDATE'],
          },
        },
      },
    };
    await fixture.aws.cloudFormation.send(new SetTypeConfigurationCommand({
      Type: 'HOOK',
      TypeArn: hookTypeArn,
      Configuration: JSON.stringify(typeConfiguration),
    }));

    // Step 7: Attempt to deploy non-compliant stack (should fail)
    try {
      const deployOutput = await fixture.cdkDeploy('guard-hook-test', {
        allowErrExit: true,
      });
      expect(deployOutput).toContain('CREATE_FAILED');
      expect(deployOutput).toContain('NonCompliant Rules:');
      expect(deployOutput).toContain('[AWS_S3_Bucket_AccessControl]');
      expect(deployOutput).toContain('• AccessControl is deprecated');
      expect(deployOutput).toContain(`Full output was written to s3://${logsBucket}`);
    } finally {
      // IAM role cleanup handled by temporaryRole
      await fixture.aws.emptyBucket(logsBucket);
      await fixture.aws.emptyBucket(rulesBucket);
      await fixture.aws.deleteBucket(logsBucket);
      await fixture.aws.deleteBucket(rulesBucket);
      await fixture.aws.cloudFormation.send(new DeactivateTypeCommand({
        Type: 'HOOK',
        Arn: hookTypeArn,
      }));
    }
  }),
);
