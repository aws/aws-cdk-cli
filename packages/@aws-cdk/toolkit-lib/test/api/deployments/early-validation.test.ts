import { EarlyValidationReporter } from '../../../lib/api/deployments/early-validation';

it('throws an error when there are failed validation events', async () => {
  const sdkMock = {
    cloudFormation: jest.fn().mockReturnValue({
      paginatedDescribeEvents: jest.fn().mockResolvedValue([
        { ValidationStatusReason: 'Resource already exists', ValidationPath: 'Resources/MyResource' },
      ]),
    }),
  };
  const ioHelperMock = { defaults: { warn: jest.fn() } };
  const reporter = new EarlyValidationReporter(sdkMock as any, ioHelperMock as any);

  await expect(reporter.report('test-change-set', 'test-stack')).rejects.toThrow(
    "ChangeSet 'test-change-set' on stack 'test-stack' failed early validation:\n  - Resource already exists (at Resources/MyResource)",
  );
});

it('does not throw when there are no failed validation events', async () => {
  const sdkMock = {
    cloudFormation: jest.fn().mockReturnValue({
      paginatedDescribeEvents: jest.fn().mockResolvedValue([]),
    }),
  };
  const ioHelperMock = { defaults: { warn: jest.fn() } };
  const reporter = new EarlyValidationReporter(sdkMock as any, ioHelperMock as any);

  await expect(reporter.report('test-change-set', 'test-stack')).resolves.not.toThrow();
  expect(ioHelperMock.defaults.warn).not.toHaveBeenCalled();
});

it('logs a warning when DescribeEvents API call fails', async () => {
  const sdkMock = {
    cloudFormation: jest.fn().mockReturnValue({
      paginatedDescribeEvents: jest.fn().mockRejectedValue(new Error('AccessDenied')),
    }),
  };
  const ioHelperMock = { defaults: { warn: jest.fn() } };
  const reporter = new EarlyValidationReporter(sdkMock as any, ioHelperMock as any);

  await reporter.report('test-change-set', 'test-stack');

  expect(ioHelperMock.defaults.warn).toHaveBeenCalledWith(
    expect.stringContaining('While creating the change set, CloudFormation detected errors in the generated templates'),
  );
});
