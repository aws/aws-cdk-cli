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
});