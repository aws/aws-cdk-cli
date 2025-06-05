import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { Configuration } from '../../lib/cli/user-configuration';
import { info } from '../../lib/logging';

jest.mock('../../lib/logging', () => ({
  info: jest.fn(),
}));

describe('telemetry command', () => {
  let configuration: Configuration;
  let toolkit: CdkToolkit;

  beforeEach(() => {
    configuration = new Configuration();
    toolkit = new CdkToolkit({
      configuration,
      sdkProvider: {} as any,
      cloudExecutable: {} as any,
      deployments: {} as any,
    });
    jest.clearAllMocks();
  });

  test('enable telemetry saves setting and displays message', async () => {
    // WHEN
    await toolkit.telemetry(true);

    // THEN
    expect(configuration.context.get('enable-cli-telemetry')).toBe(true);
    expect(info).toHaveBeenCalledWith('Telemetry enabled');
  });

  test('disable telemetry saves setting and displays message', async () => {
    // WHEN
    await toolkit.telemetry(false);

    // THEN
    expect(configuration.context.get('enable-cli-telemetry')).toBe(false);
    expect(info).toHaveBeenCalledWith('Telemetry disabled');
  });
});
