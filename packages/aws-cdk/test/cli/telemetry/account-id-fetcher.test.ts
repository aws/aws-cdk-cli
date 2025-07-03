import { AccountIdFetcher } from '../../../lib/cli/telemetry/account-id-fetcher';
import { GetCallerIdentityCommandOutput, STSClient } from '@aws-sdk/client-sts';
import { validate } from 'uuid';

describe('AccountIdFetcher', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('fetches a valid account UUID successfully', async () => {
    jest.spyOn(STSClient.prototype, 'send').mockImplementation(() =>
      Promise.resolve({
        Account: '123456789012',
      } as GetCallerIdentityCommandOutput),
    );

    const accountIdFetcher = new AccountIdFetcher(new STSClient({}));
    const accountId = await accountIdFetcher.fetch();

    expect(validate(accountId)).toBeTruthy();
  });

  test('returns no account ID when STS fails', async () => {
    jest.spyOn(STSClient.prototype, 'send').mockImplementation(() =>
      Promise.reject(new Error('STS error')),
    );

    const accountIdFetcher = new AccountIdFetcher(new STSClient({}));
    const accountId = await accountIdFetcher.fetch();

    expect(accountId).toBeUndefined();
  });
});
