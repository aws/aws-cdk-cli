import { doctor } from '../../lib/commands/doctor';
import { TestIoHost } from '../_helpers/io-host';

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('doctor');

describe('`cdk doctor`', () => {
  test('exits with 0 when everything is OK', async () => {
    const result = await doctor({ ioHelper });
    expect(result).toBe(0);
  });
});
