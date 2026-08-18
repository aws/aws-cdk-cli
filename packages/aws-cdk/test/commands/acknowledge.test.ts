import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { Configuration } from '../../lib/cli/user-configuration';

const ioHost = CliIoHost.instance({}, true);
const ioHelper = ioHost.asIoHelper();

describe('acknowledge command', () => {
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

  test('acknowledge same ID twice', async () => {
    // WHEN
    await toolkit.acknowledge('12345');
    await toolkit.acknowledge('12345');

    // THEN
    expect(configuration.context.get('acknowledged-issue-numbers')).toEqual([12345]);
  });

  test('acknowledging a scoped construct warning id throws and does not corrupt the context', async () => {
    // WHEN / THEN
    await expect(toolkit.acknowledge('@aws-cdk/aws-ecs:minHealthyPercent')).rejects.toThrow(/numeric notice IDs/i);

    // AND the context is not corrupted with a `null` entry
    expect(configuration.context.get('acknowledged-issue-numbers')).toBeUndefined();
  });

  test('acknowledging a non-numeric id throws', async () => {
    await expect(toolkit.acknowledge('not-a-number')).rejects.toThrow(/Invalid notice ID/i);
  });
});
