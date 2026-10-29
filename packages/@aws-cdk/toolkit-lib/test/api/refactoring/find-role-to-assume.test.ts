import {
  CreateStackRefactorCommand,
  DescribeStackRefactorCommand,
  DescribeStacksCommand,
  ExecuteStackRefactorCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { RefactoringContext } from '../../../lib/api/refactoring/context';
import { MockSdkProvider, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

const ioHelper = new TestIoHost().asHelper('refactor');

const environment = {
  name: 'prod',
  account: '123456789012',
  region: 'us-east-1',
};

const DEPLOYMENT_ROLE_ARN = 'arn:${AWS::Partition}:iam::123456789012:role/deployment-role';

beforeEach(() => {
  restoreSdkMocksToDefault();

  mockCloudFormationClient.on(CreateStackRefactorCommand).resolves({ StackRefactorId: 'refactor-id' });
  mockCloudFormationClient.on(DescribeStackRefactorCommand).resolves({
    Status: 'CREATE_COMPLETE',
    ExecutionStatus: 'EXECUTE_COMPLETE',
  });
  mockCloudFormationClient.on(ExecuteStackRefactorCommand).resolves({});
  mockCloudFormationClient.on(DescribeStacksCommand, { StackName: 'Foo' }).resolves({
    Stacks: [
      {
        StackName: 'Foo',
        CreationTime: new Date(),
        StackStatus: StackStatus.UPDATE_COMPLETE,
      },
    ],
  });
});

function makeContext(assumeRoleArn: string) {
  return new RefactoringContext({
    environment,
    deployedStacks: [
      {
        environment,
        stackName: 'Foo',
        template: {
          Resources: {
            OldName: { Type: 'AWS::S3::Bucket' },
          },
        },
      },
    ],
    localStacks: [
      {
        environment,
        stackName: 'Foo',
        // Deployment role ARN is only available on the local (cloud assembly) stacks.
        assumeRoleArn,
        template: {
          Resources: {
            NewName: { Type: 'AWS::S3::Bucket' },
          },
        },
      },
    ],
  });
}

test('findRoleToAssume resolves the deployment role via the SdkProvider, not a separately constructed client', async () => {
  const sdkProvider = new MockSdkProvider();
  const baseCredentialsPartitionSpy = jest.spyOn(sdkProvider, 'baseCredentialsPartition').mockResolvedValue('aws');
  const forEnvironmentSpy = jest.spyOn(sdkProvider, 'forEnvironment');

  const context = makeContext(DEPLOYMENT_ROLE_ARN);

  await context.execute([{ StackName: 'Foo', TemplateBody: '{}' }], sdkProvider, ioHelper);

  // Placeholder resolution for account/region comes from the already-resolved
  // Environment (no network call), and partition resolution goes through the
  // SdkProvider's own (proxy-aware) SDK stack, so no separate credential
  // resolution client is ever created for this call.
  expect(baseCredentialsPartitionSpy).toHaveBeenCalledWith(
    expect.objectContaining({ account: environment.account, region: environment.region }),
    expect.anything(),
  );

  // The ${AWS::Partition} placeholder in the role ARN was actually substituted
  // before the role was assumed.
  expect(forEnvironmentSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ assumeRoleArn: 'arn:aws:iam::123456789012:role/deployment-role' }),
  );

  expect(mockCloudFormationClient.commandCalls(CreateStackRefactorCommand)).toHaveLength(1);
});

test('findRoleToAssume resolves the ${AWS::AccountId} placeholder directly from the environment, with no network call', async () => {
  const sdkProvider = new MockSdkProvider();
  const forEnvironmentSpy = jest.spyOn(sdkProvider, 'forEnvironment');
  // Only stub the partition lookup; account/region substitution must not call anything on sdkProvider.
  jest.spyOn(sdkProvider, 'baseCredentialsPartition').mockResolvedValue('aws');

  const context = makeContext('arn:aws:iam::${AWS::AccountId}:role/deployment-role');

  await context.execute([{ StackName: 'Foo', TemplateBody: '{}' }], sdkProvider, ioHelper);

  expect(forEnvironmentSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ assumeRoleArn: `arn:aws:iam::${environment.account}:role/deployment-role` }),
  );
});

test('findRoleToAssume proceeds without a role when no stacks declare one', async () => {
  const sdkProvider = new MockSdkProvider();
  const baseCredentialsPartitionSpy = jest.spyOn(sdkProvider, 'baseCredentialsPartition');

  const context = makeContext(undefined as unknown as string);

  await context.execute([{ StackName: 'Foo', TemplateBody: '{}' }], sdkProvider, ioHelper);

  // No role ARN means no placeholder substitution is needed, so the SdkProvider
  // is never asked for the partition either.
  expect(baseCredentialsPartitionSpy).not.toHaveBeenCalled();
});
