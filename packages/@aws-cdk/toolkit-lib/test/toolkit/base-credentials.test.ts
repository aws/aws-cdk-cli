import { BaseCredentials } from '../../lib/api/aws-auth/types';
import { SdkProvider } from '../../lib/api/shared-private';
import { Toolkit } from '../../lib/toolkit/toolkit';
import { appFixture, TestIoHost } from '../_helpers';
import { MockSdk } from '../_helpers/mock-sdk';

let ioHost: TestIoHost;
let makeSdk: jest.SpiedFunction<SdkProvider['_makeSdk']>;

beforeEach(() => {
  jest.restoreAllMocks();
  ioHost = new TestIoHost();
  makeSdk = jest.spyOn(SdkProvider.prototype, '_makeSdk').mockReturnValue(new MockSdk());
});

test('custom credentials can be used for synth', async () => {
  const customProvider = async () => ({ accessKeyId: 'a', secretAccessKey: 's' });
  const toolkit = new Toolkit({
    ioHost,
    sdkConfig: {
      baseCredentials: BaseCredentials.custom({
        provider: customProvider,
        region: 'south-pole-1',
      }),
    },
  });

  const cx = await appFixture(toolkit, 'stack-with-env-from-env');
  await using asm = await toolkit.synth(cx);

  expect(asm.cloudAssembly.getStackByName('Stack1').environment).toMatchObject({
    account: '123456789012', // Returned from the MockSdk
    region: 'south-pole-1', // Configured by the BaseCredentials
  });
  expect(makeSdk).toHaveBeenCalledWith(customProvider, expect.anything());
});

test('none credentials can be used for a self-defining stack', async () => {
  const toolkit = new Toolkit({
    ioHost,
    sdkConfig: {
      baseCredentials: BaseCredentials.none(),
    },
  });

  const cx = await appFixture(toolkit, 'stack-with-defined-env');
  await using asm = await toolkit.synth(cx);

  expect(asm.cloudAssembly.getStackByName('Stack1').environment).toMatchObject({
    account: '11111111111',
    region: 'us-east-1',
  });
});

test.each([
  [BaseCredentials.awsCliCompatible({ profile: 'this-profile-doesnt-exist' }), true],
  [BaseCredentials.custom({ provider: () => Promise.resolve({ accessKeyId: 'a', secretAccessKey: 's' }) }), false],
  [BaseCredentials.none(), false],
])('credentials %s respects environment variables: %p', async (baseCredentials, respectsEnv) => {
  const toolkit = new Toolkit({
    ioHost,
    sdkConfig: { baseCredentials },
  });

  // We create the SdkProvider currently *inside* `appFixture`, so this needs to be set beforehand
  process.env.AWS_REGION = 'south-pole-1';

  const cx = await appFixture(toolkit, 'stack-with-env-from-env');
  await using _ = await toolkit.synth(cx);

  expect(makeSdk).toHaveBeenCalledWith(expect.anything(), respectsEnv ? 'south-pole-1' : 'us-east-1');

  delete process.env.AWS_REGION;
});
