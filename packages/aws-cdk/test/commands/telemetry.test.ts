import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { Configuration } from '../../lib/cli/user-configuration';

const ioHost = CliIoHost.instance({}, true);
const ioHelper = ioHost.asIoHelper();
const notifySpy = jest.spyOn(ioHost, 'notify');

describe('telemetry command', () => {
  let configuration: Configuration;
  let toolkit: CdkToolkit;

  beforeEach(async () => {
    configuration = await Configuration.fromArgs(ioHelper);
    toolkit = new CdkToolkit({
      ioHost,
      configuration,
      sdkProvider: {} as any,
      cloudExecutable: {} as any,
      deployments: {} as any,
    });
    jest.clearAllMocks();
  });

  test('enable telemetry saves setting and displays message', async () => {
    // WHEN
    await toolkit.cliTelemetry(true);

    // THEN
    expect(configuration.context.get('cli-telemetry')).toBe(true);
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: 'Telemetry enabled' }));
  });

  test('disable telemetry saves setting and displays message', async () => {
    // WHEN
    await toolkit.cliTelemetry(false);

    // THEN
    expect(configuration.context.get('cli-telemetry')).toBe(false);
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: 'Telemetry disabled' }));
  });

  test('status reports current telemetry status -- enabled by default', async () => {
    // WHEN
    await toolkit.cliTelemetryStatus();

    // THEN
    expect(info).toHaveBeenCalledWith('CLI Telemetry is enabled. Run \'cdk cli-telemetry --disable\' to disable for this CDK App.');
  });

  test('status reports current telemetry status -- enabled intentionally', async () => {
    // WHEN
    configuration.context.set('cli-telemetry', true);
    await toolkit.cliTelemetryStatus();

    // THEN
    expect(info).toHaveBeenCalledWith('CLI Telemetry is enabled. Run \'cdk cli-telemetry --disable\' to disable for this CDK App.');
  });

  test('status reports current telemetry status -- disabled via context', async () => {
    // WHEN
    configuration.context.set('cli-telemetry', false);
    await toolkit.cliTelemetryStatus();

    // THEN
    expect(info).toHaveBeenCalledWith('CLI Telemetry is disabled. Run \'cdk cli-telemetry --enable\' to enable for this CDK App.');
  });

  test('status reports current telemetry status -- disabled via env var', async () => {
    // WHEN
    const CDK_CLI_DISABLE_TELEMETRY = process.env.CDK_CLI_DISABLE_TELEMETRY;
    process.env.CDK_CLI_DISABLE_TELEMETRY = 'true';
    await toolkit.cliTelemetryStatus();

    // THEN
    expect(info).toHaveBeenCalledWith('CLI Telemetry is disabled. Run \'cdk cli-telemetry --enable\' to enable for this CDK App.');
    process.env.CDK_CLI_DISABLE_TELEMETRY = CDK_CLI_DISABLE_TELEMETRY;
  });
});
