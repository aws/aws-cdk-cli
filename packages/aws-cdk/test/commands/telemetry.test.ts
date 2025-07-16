import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { Configuration } from '../../lib/cli/user-configuration';
import { withEnv } from '../_helpers/with-env';

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
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: 'CLI Telemetry is enabled. See https://github.com/aws/aws-cdk-cli/tree/main/packages/aws-cdk#cdk-cli-telemetry for ways to disable.' }));
  });

  test('status reports current telemetry status -- enabled intentionally', async () => {
    // WHEN
    configuration.context.set('cli-telemetry', true);
    await toolkit.cliTelemetryStatus();

    // THEN
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: 'CLI Telemetry is enabled. See https://github.com/aws/aws-cdk-cli/tree/main/packages/aws-cdk#cdk-cli-telemetry for ways to disable.' }));
  });

  test('status reports current telemetry status -- disabled via context', async () => {
    // WHEN
    configuration.context.set('cli-telemetry', false);
    await toolkit.cliTelemetryStatus();

    // THEN
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: 'CLI Telemetry is disabled. See https://github.com/aws/aws-cdk-cli/tree/main/packages/aws-cdk#cdk-cli-telemetry for ways to enable.' }));
  });

  test('status reports current telemetry status -- disabled via env var', async () => {
    withEnv(async () => {
      // WHEN
      process.env.CDK_CLI_DISABLE_TELEMETRY = 'true';
      await toolkit.cliTelemetryStatus();

      // THEN
      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: 'CLI Telemetry is disabled. See https://github.com/aws/aws-cdk-cli/tree/main/packages/aws-cdk#cdk-cli-telemetry for ways to enable.' }));
    }, {
      CDK_CLI_DISABLE_TELEMETRY: 'true',
    });
  });
});
