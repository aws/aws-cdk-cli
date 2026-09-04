import type { DescribeChangeSetCommandOutput } from '@aws-sdk/client-cloudformation';
import { DescribeChangeSetCommand } from '@aws-sdk/client-cloudformation';
import type { ICloudFormationClient } from '../../../lib/api/aws-auth/private';
import { ChangeSetDescriber } from '../../../lib/api/change-sets';
import type { CloudFormationStackDiagnoser } from '../../../lib/api/diagnosing/stack-diagnoser';
import { MockSdk, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('diff');
const diagnoser = { diagnoseChangeSet: async () => ({ type: 'no-problem' }) } as unknown as CloudFormationStackDiagnoser;

/**
 * The warning CloudFormation adds to `StatusReason` when it dropped data from a response that was
 * requested with `IncludePropertyValues`. See https://github.com/aws/aws-cdk-cli/issues/1780
 */
const INCOMPLETE_DATA_WARNING = '[WARN] --include-property-values option can return incomplete ChangeSet data because: Logical Id: DataSource, failed property validation';

let cfn: ICloudFormationClient;

beforeEach(() => {
  restoreSdkMocksToDefault();
  cfn = new MockSdk().cloudFormation();
});

function describer() {
  return new ChangeSetDescriber({
    cfn,
    ioHelper,
    stackNameOrArn: 'my-stack',
    changeSetNameOrArn: 'my-change-set',
  });
}

/**
 * Make DescribeChangeSet return `detailed` when property values are requested, and `plain` otherwise.
 *
 * The detailed response carries the incomplete-data warning, so that the describer goes looking for
 * what CloudFormation dropped.
 */
function mockFlaggedResponses(detailed: Partial<DescribeChangeSetCommandOutput>, plain: Partial<DescribeChangeSetCommandOutput>) {
  mockCloudFormationClient.on(DescribeChangeSetCommand, { IncludePropertyValues: true }).resolves({
    Status: 'CREATE_COMPLETE',
    StatusReason: INCOMPLETE_DATA_WARNING,
    ...detailed,
  });
  mockCloudFormationClient.on(DescribeChangeSetCommand, { IncludePropertyValues: false }).resolves({ Status: 'CREATE_COMPLETE', ...plain });
}

function plainDescribeCalls() {
  return mockCloudFormationClient.commandCalls(DescribeChangeSetCommand)
    .filter((call) => call.args[0].input.IncludePropertyValues === false);
}

describe('ChangeSetDescriber', () => {
  test('restores a resource change that CloudFormation dropped from the detailed response', async () => {
    // GIVEN - https://github.com/aws/aws-cdk-cli/issues/1780: with IncludePropertyValues,
    // CFN drops the ResourceChange, leaving only a WARN in StatusReason
    mockFlaggedResponses(
      {
        Changes: [],
      },
      {
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'DataSource',
            ResourceType: 'AWS::QBusiness::DataSource',
            Replacement: 'False',
            Scope: ['Properties'],
            Details: [{
              Target: { Attribute: 'Properties', Name: 'Configuration', RequiresRecreation: 'Never' },
              Evaluation: 'Static',
              ChangeSource: 'DirectModification',
            }],
          },
        }],
      },
    );

    // WHEN
    const { changeSet: description } = await describer().waitForReport({ diagnoser });

    // THEN
    expect(description.Changes).toHaveLength(1);
    expect(description.Changes?.[0].ResourceChange?.LogicalResourceId).toEqual('DataSource');
    expect(description.Changes?.[0].ResourceChange?.Details?.[0].Target?.Name).toEqual('Configuration');
  });

  test('keeps the real status reason rather than the incomplete-data warning', async () => {
    // GIVEN - a change set that failed to create, described as incomplete. The real reason is what
    // tells the diagnoser this was an early validation failure, so the warning must not displace it.
    mockFlaggedResponses(
      { Status: 'FAILED', Changes: [] },
      { Status: 'FAILED', StatusReason: '(AWS::EarlyValidation::SomeError). Blah blah blah.', Changes: [] },
    );

    // WHEN
    const description = await describer().describeCurrentState();

    // THEN
    expect(description.StatusReason).toEqual('(AWS::EarlyValidation::SomeError). Blah blah blah.');
  });

  test('keeps the detailed change (with property values) when a resource is present in both responses', async () => {
    // GIVEN
    mockFlaggedResponses(
      {
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'Bucket',
            ResourceType: 'AWS::S3::Bucket',
            BeforeContext: '{"Properties":{"BucketName":"old"}}',
            AfterContext: '{"Properties":{"BucketName":"new"}}',
            Details: [{
              Target: { Attribute: 'Properties', Name: 'BucketName', RequiresRecreation: 'Always', BeforeValue: 'old', AfterValue: 'new' },
              ChangeSource: 'DirectModification',
            }],
          },
        }],
      },
      {
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'Bucket',
            ResourceType: 'AWS::S3::Bucket',
            Details: [{
              Target: { Attribute: 'Properties', Name: 'BucketName', RequiresRecreation: 'Always' },
              ChangeSource: 'DirectModification',
            }],
          },
        }],
      },
    );

    // WHEN
    const { changeSet: description } = await describer().waitForReport({ diagnoser });

    // THEN - no duplicates, and the value-carrying detailed change wins
    expect(description.Changes).toHaveLength(1);
    expect(description.Changes?.[0].ResourceChange?.BeforeContext).toEqual('{"Properties":{"BucketName":"old"}}');
    expect(description.Changes?.[0].ResourceChange?.Details).toHaveLength(1);
    expect(description.Changes?.[0].ResourceChange?.Details?.[0].Target?.BeforeValue).toEqual('old');
  });

  test('restores per-property change details dropped from the detailed response', async () => {
    // GIVEN - the resource is present in both, but the detailed response is missing a detail
    mockFlaggedResponses(
      {
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'DataSource',
            Details: [{
              Target: { Attribute: 'Properties', Name: 'DisplayName', RequiresRecreation: 'Never', BeforeValue: 'a', AfterValue: 'b' },
              ChangeSource: 'DirectModification',
            }],
          },
        }],
      },
      {
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'DataSource',
            Details: [
              {
                Target: { Attribute: 'Properties', Name: 'DisplayName', RequiresRecreation: 'Never' },
                ChangeSource: 'DirectModification',
              },
              {
                Target: { Attribute: 'Properties', Name: 'Configuration', RequiresRecreation: 'Never' },
                ChangeSource: 'DirectModification',
              },
            ],
          },
        }],
      },
    );

    // WHEN
    const { changeSet: description } = await describer().waitForReport({ diagnoser });

    // THEN
    const details = description.Changes?.[0].ResourceChange?.Details;
    expect(details).toHaveLength(2);
    // the detail present in both keeps its detailed (value-carrying) version
    expect(details?.find((d) => d.Target?.Name === 'DisplayName')?.Target?.BeforeValue).toEqual('a');
    // the dropped detail is restored
    expect(details?.find((d) => d.Target?.Name === 'Configuration')).toBeDefined();
  });

  test('does not treat details with a different change source as the same change', async () => {
    // GIVEN
    mockFlaggedResponses(
      {
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'Bucket',
            Details: [{
              Target: { Attribute: 'Properties', Name: 'BucketName', RequiresRecreation: 'Always' },
              Evaluation: 'Static',
              ChangeSource: 'DirectModification',
            }],
          },
        }],
      },
      {
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'Bucket',
            Details: [{
              Target: { Attribute: 'Properties', Name: 'BucketName', RequiresRecreation: 'Always' },
              Evaluation: 'Dynamic',
              ChangeSource: 'ParameterReference',
              CausingEntity: 'MyParam',
            }],
          },
        }],
      },
    );

    // WHEN
    const { changeSet: description } = await describer().waitForReport({ diagnoser });

    // THEN
    expect(description.Changes?.[0].ResourceChange?.Details).toHaveLength(2);
  });

  test('skips plain changes that cannot be correlated by logical id', async () => {
    // GIVEN
    mockFlaggedResponses(
      { Changes: [] },
      { Changes: [{ Type: 'Resource', ResourceChange: { Action: 'Modify' } }] },
    );

    // WHEN
    const { changeSet: description } = await describer().waitForReport({ diagnoser });

    // THEN
    expect(description.Changes).toHaveLength(0);
  });

  test('logs that it is describing the change set again', async () => {
    // GIVEN
    ioHost.level = 'debug';
    mockFlaggedResponses(
      { Changes: [] },
      { Changes: [{ Type: 'Resource', ResourceChange: { Action: 'Modify', LogicalResourceId: 'DataSource' } }] },
    );

    // WHEN
    await describer().describeCurrentState();

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'debug',
      message: expect.stringContaining('was described with incomplete data'),
    }));
  });

  test('describes the change set a second time when CloudFormation flags the response as incomplete', async () => {
    // GIVEN
    mockFlaggedResponses({ Changes: [] }, { Changes: [] });

    // WHEN
    await describer().waitForReport({ diagnoser });

    // THEN
    expect(plainDescribeCalls()).toHaveLength(1);
  });

  test('does not describe the change set a second time when the response is not flagged', async () => {
    // GIVEN - a normal response, without the incomplete-data warning
    mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({ Status: 'CREATE_COMPLETE', Changes: [] });

    // WHEN
    await describer().waitForReport({ diagnoser });

    // THEN - a single describe, with property values
    const calls = mockCloudFormationClient.commandCalls(DescribeChangeSetCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.IncludePropertyValues).toBe(true);
  });

  test('does not describe a second time for an ordinary status reason', async () => {
    // GIVEN - an empty change set: FAILED with a status reason, but no warning. This is the common
    // case for a no-op diff or deploy, so it must not cost a second call.
    mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
      Status: 'FAILED',
      StatusReason: "The submitted information didn't contain changes.",
      Changes: [],
    });

    // WHEN
    await describer().describeCurrentState();

    // THEN
    expect(mockCloudFormationClient.commandCalls(DescribeChangeSetCommand)).toHaveLength(1);
  });

  test('does not describe a second time while the change set is still creating', async () => {
    // GIVEN - still creating on the first poll, flagged as incomplete even then (which we don't
    // expect CloudFormation to do, but we should not pay for it if it does)
    mockCloudFormationClient.on(DescribeChangeSetCommand, { IncludePropertyValues: true })
      .resolvesOnce({ Status: 'CREATE_IN_PROGRESS', StatusReason: INCOMPLETE_DATA_WARNING })
      .resolves({ Status: 'CREATE_COMPLETE', StatusReason: INCOMPLETE_DATA_WARNING, Changes: [] });
    mockCloudFormationClient.on(DescribeChangeSetCommand, { IncludePropertyValues: false }).resolves({ Status: 'CREATE_COMPLETE', Changes: [] });

    // WHEN
    await describer().waitForReport({ diagnoser });

    // THEN - the plain describe only happened for the terminal state, not for the in-progress poll
    expect(plainDescribeCalls()).toHaveLength(1);
  });

  test('always fetches all pages of changes', async () => {
    // GIVEN - the first page carries a NextToken
    mockCloudFormationClient.on(DescribeChangeSetCommand)
      .callsFake((input) => {
        if (input.NextToken) {
          return {
            Status: 'CREATE_COMPLETE',
            Changes: [{ Type: 'Resource', ResourceChange: { Action: 'Modify', LogicalResourceId: 'Second' } }],
          };
        }
        return {
          Status: 'CREATE_COMPLETE',
          NextToken: 'page-2',
          Changes: [{ Type: 'Resource', ResourceChange: { Action: 'Modify', LogicalResourceId: 'First' } }],
        };
      });

    // WHEN
    const description = await describer().describeCurrentState();

    // THEN - changes from both pages are present
    expect(description.Changes?.map((c) => c.ResourceChange?.LogicalResourceId).sort()).toEqual(['First', 'Second']);
  });
});
