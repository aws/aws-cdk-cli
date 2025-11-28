import { ChangeSetStatus } from '@aws-sdk/client-cloudformation';
import { EarlyValidationReporter } from '../../../lib/api/deployments/early-validation';

describe('EarlyValidationReporter', () => {
  let mockSdk: any;
  let mockEnvironmentResources: any;
  let reporter: EarlyValidationReporter;

  beforeEach(() => {
    mockSdk = {
      cloudFormation: jest.fn().mockReturnValue({
        describeEvents: jest.fn(),
      }),
    };
    mockEnvironmentResources = {
      environment: { account: '123456789012', region: 'us-east-1' },
      lookupToolkit: jest.fn(),
    };
    reporter = new EarlyValidationReporter(mockSdk, mockEnvironmentResources);
  });

  it('does not throw when ChangeSet status is FAILED but reason is not AWS::EarlyValidation', async () => {
    const description = {
      $metadata: {},
      Status: ChangeSetStatus.FAILED,
      StatusReason: 'Some other reason',
    };
    const changeSetName = 'test-change-set';
    const stackName = 'test-stack';

    await expect(reporter.check(description, changeSetName, stackName)).resolves.not.toThrow();
  });

  it('does not throw when ChangeSet status is undefined', async () => {
    const description = {
      $metadata: {},
      Status: undefined,
      StatusReason: undefined,
    };
    const changeSetName = 'test-change-set';
    const stackName = 'test-stack';

    await expect(reporter.check(description, changeSetName, stackName)).resolves.not.toThrow();
  });

  it('throws when ChangeSet status is FAILED due to AWS::EarlyValidation', async () => {
    const description = {
      $metadata: {},
      Status: ChangeSetStatus.FAILED,
      StatusReason: 'The following resource(s) failed to create: [MyResource] (AWS::EarlyValidation).',
    };
    const changeSetName = 'test-change-set';
    const stackName = 'test-stack';

    mockSdk.cloudFormation().describeEvents.mockResolvedValue({
      OperationEvents: [
        {
          ValidationStatus: 'FAILED',
          ValidationStatusReason: 'Resource already exists',
          ValidationPath: 'Resources/MyResource',
        },
      ],
    });

    await expect(reporter.check(description, changeSetName, stackName)).rejects.toThrow(
      `ChangeSet 'test-change-set' on stack 'test-stack' failed early validation:
  - Resource already exists (at Resources/MyResource)`,
    );
  });

  it('throws with bootstrap version less than 30', async () => {
    const description = {
      $metadata: {},
      Status: ChangeSetStatus.FAILED,
      StatusReason: 'The following resource(s) failed to create: [MyResource] (AWS::EarlyValidation).',
    };
    const changeSetName = 'test-change-set';
    const stackName = 'test-stack';

    mockEnvironmentResources.lookupToolkit.mockResolvedValue({ version: 29 });

    await expect(reporter.check(description, changeSetName, stackName)).rejects.toThrow(
      `While creating the change set, CloudFormation detected errors in the generated templates.
To see details about these errors, re-bootstrap your environment with 'cdk bootstrap aws://123456789012/us-east-1', and run 'cdk deploy' again.`,
    );
  });
});
