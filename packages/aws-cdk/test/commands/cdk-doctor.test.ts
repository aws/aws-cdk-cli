import { Settings } from '../../lib/api/settings';
import { doctor } from '../../lib/commands/doctor';
import { TestIoHost } from '../_helpers/io-host';

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('doctor');

describe('`cdk doctor`', () => {
  beforeEach(() => {
    ioHost.notifySpy.mockClear();
  });

  test('exits with 0 when everything is OK', async () => {
    const result = await doctor({ ioHelper });
    expect(result).toBe(0);
  });

  test('prints the CLI configuration as a single line from settings', async () => {
    const settings = new Settings({ debugApp: true, debugCli: false, verbose: 2 });
    await doctor({ ioHelper, settings });

    const messages = ioHost.notifySpy.mock.calls.map((c) => c[0].message);
    const configLineIndex = messages.findIndex((m) => m.includes('CDK CLI Version')) + 1;
    const configLine = messages[configLineIndex];

    expect(configLine).toBeDefined();
    expect(configLine).toContain('extra verbosity');
    expect(configLine).toContain('-vv');
    expect(configLine).toContain('debugging CDK app');
    expect(configLine).not.toContain('CLI');
  });

  test('reports everything disabled when no settings are provided', async () => {
    await doctor({ ioHelper });

    const messages = ioHost.notifySpy.mock.calls.map((c) => c[0].message);
    const configLineIndex = messages.findIndex((m) => m.includes('CDK CLI Version')) + 1;
    const configLine = messages[configLineIndex];

    expect(configLine).toBeDefined();
    expect(configLine).toContain('normal verbosity');
    expect(configLine).toContain('no debugging');
    expect(configLine).not.toContain('CLI');
    expect(configLine).not.toContain('CDK apps');
  });
});
