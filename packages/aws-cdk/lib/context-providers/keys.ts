import type { KeyContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { KeyContextResponse } from '@aws-cdk/cx-api';
import type { AliasListEntry, ListAliasesCommandOutput } from '@aws-sdk/client-kms';
import type { IContextProviderMessages } from '.';
import { ContextProviderError } from '../../../@aws-cdk/tmp-toolkit-helpers/src/api';
import type { IKMSClient } from '../api';
import { type SdkProvider, initContextProviderSdk } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';

export class KeyContextProviderPlugin implements ContextProviderPlugin {
  constructor(private readonly aws: SdkProvider, private readonly io: IContextProviderMessages) {
  }

  public async getValue(args: KeyContextQuery) {
    const kms = (await initContextProviderSdk(this.aws, args)).kms();

    const aliasListEntry = await this.findKey(kms, args);

    return this.readKeyProps(aliasListEntry, args);
  }

  // TODO: use paginator function
  private async findKey(kms: IKMSClient, args: KeyContextQuery): Promise<AliasListEntry> {
    await this.io.debug(`Listing keys in ${args.account}:${args.region}`);

    let response: ListAliasesCommandOutput;
    let nextMarker: string | undefined;
    do {
      response = await kms.listAliases({
        Marker: nextMarker,
      });

      const aliases = response.Aliases || [];
      for (const alias of aliases) {
        if (alias.AliasName == args.aliasName) {
          return alias;
        }
      }

      nextMarker = response.NextMarker;
    } while (nextMarker);

    const suppressError = 'ignoreErrorOnMissingContext' in args && args.ignoreErrorOnMissingContext as boolean;
    const hasDummyKeyId = 'dummyValue' in args && typeof args.dummyValue === 'object' && args.dummyValue !== null && 'keyId' in args.dummyValue;
    if (suppressError && hasDummyKeyId) {
      const keyId = (args.dummyValue as { keyId: string }).keyId;
      return { TargetKeyId: keyId };
    }
    throw new ContextProviderError(`Could not find any key with alias named ${args.aliasName}`);
  }

  private async readKeyProps(alias: AliasListEntry, args: KeyContextQuery): Promise<KeyContextResponse> {
    if (!alias.TargetKeyId) {
      throw new ContextProviderError(`Could not find any key with alias named ${args.aliasName}`);
    }

    await this.io.debug(`Key found ${alias.TargetKeyId}`);

    return {
      keyId: alias.TargetKeyId,
    };
  }
}
