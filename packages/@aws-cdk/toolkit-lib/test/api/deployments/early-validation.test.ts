import { EarlyValidationReporter } from '../../../lib/api/deployments/early-validation';

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

  await expect(reporter.fetchDetails('test-change-set', 'test-stack')).resolves.toEqual(
    "ChangeSet 'test-change-set' on stack 'test-stack' failed early validation:\n  - Resource already exists (at Resources/MyResource)\n",
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

  await expect(reporter.fetchDetails('test-change-set', 'test-stack')).resolves.toEqual(
    "ChangeSet 'test-change-set' on stack 'test-stack' failed early validation",
  );
});

it('returns an explanatory message when DescribeEvents API call fails', async () => {
  const sdkMock = {
    cloudFormation: jest.fn().mockReturnValue({
      paginatedDescribeEvents: jest.fn().mockRejectedValue(new Error('AccessDenied')),
    }),
  };
  const envResourcesMock = { lookupToolkit: jest.fn().mockResolvedValue({ version: 29 }) };
  const reporter = new EarlyValidationReporter(sdkMock as any, envResourcesMock as any);

  const result = await reporter.fetchDetails('test-change-set', 'test-stack');

  expect(result).toContain('The template cannot be deployed because of early validation errors');
  expect(result).toContain('AccessDenied');
  expect(result).toContain('29');
});
