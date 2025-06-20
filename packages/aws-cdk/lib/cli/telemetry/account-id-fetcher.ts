import {
  GetCallerIdentityCommand,
  GetCallerIdentityCommandOutput,
  STSClient,
} from '@aws-sdk/client-sts';
import { v5 as uuidV5 } from 'uuid';

// eslint-disable-next-line spellcheck/spell-checker
const CDK_CLI_UUID_NAMESPACE = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'; // A random v4 UUID

/**
 * Retrieves the account ID of the user
 */
export class AccountIdFetcher {
  private accountIdPromise?: Promise<GetCallerIdentityCommandOutput>;
  /**
   * constructor for AccountIdFetcher
   */
  constructor(private readonly stsClient = new STSClient()) {}
  fetch = async () => {
    if (this.accountIdPromise) {
      try {
        const stsResponse = await this.accountIdPromise;
        return this.getAccountIdFromStsResponse(stsResponse);
      } catch {
        // We failed to get the account Id. Most likely the user doesn't have credentials
        return;
      }
    }
    try {
      this.accountIdPromise = this.stsClient.send(
        new GetCallerIdentityCommand({}),
      );
      const stsResponse = await this.accountIdPromise;
      return this.getAccountIdFromStsResponse(stsResponse);
    } catch {
      // We failed to get the account Id. Most likely the user doesn't have credentials
      return;
    }
  };

  private getAccountIdFromStsResponse = (
    stsResponse: GetCallerIdentityCommandOutput,
  ) => {
    if (stsResponse && stsResponse.Account) {
      return uuidV5(
        stsResponse.Account,
        CDK_CLI_UUID_NAMESPACE,
      );
    }
    // We failed to get the account Id. Most likely the user doesn't have credentials
    return;
  };
}
