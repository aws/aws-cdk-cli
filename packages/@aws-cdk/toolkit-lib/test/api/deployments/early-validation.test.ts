import { EarlyValidationReporter } from '../../../lib/api/diagnosing/early-validation';
import type { IoHelper } from '../../../lib/api/io/private/io-helper';

const ioHelperMock = () => ({ defaults: { warn: jest.fn() } }) as any as IoHelper;

it('returns details when there are failed validation events', async () => {
  const sdkMock = {
    cloudFormation: jest.fn().mockReturnValue({
      paginatedDescribeEvents: jest.fn().mockResolvedValue([
        { ValidationStatusReason: 'Resource already exists', ValidationPath: 'Resources/MyResource' },
      ]),
    }),
  };
  const envResourcesMock = { lookupToolkit: jest.fn().mockResolvedValue({ version: 30 }) };
  const reporter = new EarlyValidationReporter(sdkMock as any, envResourcesMock as any);

  await expect(reporter.fetchDetailsString('test-change-set', 'test-stack', ioHelperMock())).resolves.toEqual(
    "Early validation failed for stack 'test-stack' (ChangeSet 'test-change-set'):\n  - Resource already exists (at Resources/MyResource)",
  );
});

it('returns a summary when there are no failed validation events', async () => {
  const sdkMock = {
    cloudFormation: jest.fn().mockReturnValue({
      paginatedDescribeEvents: jest.fn().mockResolvedValue([]),
    }),
  };
  const envResourcesMock = { lookupToolkit: jest.fn().mockResolvedValue({ version: 30 }) };
  const reporter = new EarlyValidationReporter(sdkMock as any, envResourcesMock as any);

  await expect(reporter.fetchDetailsString('test-change-set', 'test-stack', ioHelperMock())).resolves.toEqual(
    "Early validation failed for stack 'test-stack' (ChangeSet 'test-change-set')",
  );
});

it('logs a warning and returns the plain summary when DescribeEvents API call fails', async () => {
  const sdkMock = {
    cloudFormation: jest.fn().mockReturnValue({
      paginatedDescribeEvents: jest.fn().mockRejectedValue(new Error('AccessDenied')),
    }),
  };
  const envResourcesMock = { lookupToolkit: jest.fn().mockResolvedValue({ version: 29 }) };
  const ioHelper = ioHelperMock();
  const reporter = new EarlyValidationReporter(sdkMock as any, envResourcesMock as any);

  const result = await reporter.fetchDetailsString('test-change-set', 'test-stack', ioHelper);

  expect(result).toEqual("Early validation failed for stack 'test-stack' (ChangeSet 'test-change-set')");
  expect(ioHelper.defaults.warn).toHaveBeenCalledTimes(1);
  expect(ioHelper.defaults.warn).toHaveBeenCalledWith(
    'Could not retrieve additional details about early validation errors (Error: AccessDenied). ' +
    "Make sure you have permissions to call the DescribeEvents API, or re-bootstrap your environment by running 'cdk bootstrap' to update the Bootstrap CDK Toolkit stack. " +
    'Bootstrap toolkit stack version 30 or later is needed; current version: 29.',
  );
});
