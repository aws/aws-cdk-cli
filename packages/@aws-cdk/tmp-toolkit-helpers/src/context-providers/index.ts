import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import * as cxapi from '@aws-cdk/cx-api';
import { AmiContextProviderPlugin } from './ami';
import { AZContextProviderPlugin } from './availability-zones';
import { CcApiContextProviderPlugin } from './cc-api-provider';
import { EndpointServiceAZContextProviderPlugin } from './endpoint-service-availability-zones';
import { HostedZoneContextProviderPlugin } from './hosted-zones';
import { KeyContextProviderPlugin } from './keys';
import { LoadBalancerContextProviderPlugin, LoadBalancerListenerContextProviderPlugin } from './load-balancers';
import { SecurityGroupContextProviderPlugin } from './security-groups';
import { SSMContextProviderPlugin } from './ssm-parameters';
import { VpcNetworkContextProviderPlugin } from './vpcs';
import type { SdkProvider } from '../api/aws-auth';
import type { Context } from '../api/context';
import { TRANSIENT_CONTEXT_KEY } from '../api/context';
import { replaceEnvPlaceholders } from '../api/environment';
import { IO } from '../api/io/private';
import type { IoHelper } from '../api/io/private';
import type { PluginHost, ContextProviderPlugin } from '../api/plugin';
import { ContextProviderError } from '../api/toolkit-error';
import { formatErrorMessage } from '../util';

type ContextProviderFactory = ((sdk: SdkProvider, io: IContextProviderMessages) => ContextProviderPlugin);
type ProviderMap = {[name: string]: ContextProviderFactory};

const PLUGIN_PROVIDER_PREFIX = 'plugin';

export interface IContextProviderMessages {
  /**
   * A message that is presented to users in normal mode of operation.
   *
   * Should be used sparingly. The Context Provider framework already provides useful output by default.
   * This can be uses in exceptionally situations, e.g. if a lookup call is expected to take a long time.
   */
  info(message: string): Promise<void>;

  /**
   * A message that helps users debugging the context provider.
   *
   * Should be used in most cases to note on current action.
   */
  debug(message: string): Promise<void>;
}

class ContextProviderMessages implements IContextProviderMessages {
  private readonly ioHelper: IoHelper;
  private readonly providerName: string;

  public constructor(ioHelper: IoHelper, providerName: string) {
    this.ioHelper = ioHelper;
    this.providerName = providerName;
  }

  public async info(message: string): Promise<void> {
    return this.ioHelper.notify(IO.CDK_ASSEMBLY_I0300.msg(message, {
      provider: this.providerName,
    }));
  }

  public async debug(message: string): Promise<void> {
    return this.ioHelper.notify(IO.CDK_ASSEMBLY_I0301.msg(message, {
      provider: this.providerName,
    }));
  }
}

/**
 * Iterate over the list of missing context values and invoke the appropriate providers from the map to retrieve them
 */
export async function provideContextValues(
  missingValues: cxschema.MissingContext[],
  context: Context,
  sdk: SdkProvider,
  pluginHost: PluginHost,
  ioHelper: IoHelper,
) {
  for (const missingContext of missingValues) {
    const key = missingContext.key;

    const providerName = missingContext.provider === cxschema.ContextProvider.PLUGIN
      ? `${PLUGIN_PROVIDER_PREFIX}:${(missingContext.props as cxschema.PluginContextQuery).pluginName}`
      : missingContext.provider;

    let factory;
    if (providerName.startsWith(`${PLUGIN_PROVIDER_PREFIX}:`)) {
      const plugin = pluginHost.contextProviderPlugins[providerName.substring(PLUGIN_PROVIDER_PREFIX.length + 1)];
      if (!plugin) {
        // eslint-disable-next-line max-len
        throw new ContextProviderError(`Unrecognized plugin context provider name: ${missingContext.provider}.`);
      }
      factory = () => plugin;
    } else {
      factory = availableContextProviders[providerName];
      if (!factory) {
        // eslint-disable-next-line max-len
        throw new ContextProviderError(`Unrecognized context provider name: ${missingContext.provider}. You might need to update the toolkit to match the version of the construct library.`);
      }
    }

    const provider = factory(sdk, new ContextProviderMessages(ioHelper, providerName));

    let value;
    try {
      const environment = missingContext.props.account && missingContext.props.region
        ? cxapi.EnvironmentUtils.make(missingContext.props.account, missingContext.props.region)
        : undefined;

      const resolvedEnvironment: cxapi.Environment = environment
        ? await sdk.resolveEnvironment(environment)
        : { account: '?', region: '?', name: '?' };

      const arns = await replaceEnvPlaceholders({
        lookupRoleArn: missingContext.props.lookupRoleArn,
      }, resolvedEnvironment, sdk);

      value = await provider.getValue({ ...missingContext.props, lookupRoleArn: arns.lookupRoleArn });
    } catch (e: any) {
      // Set a specially formatted provider value which will be interpreted
      // as a lookup failure in the toolkit.
      value = { [cxapi.PROVIDER_ERROR_KEY]: formatErrorMessage(e), [TRANSIENT_CONTEXT_KEY]: true };
    }
    context.set(key, value);
    await ioHelper.notify(IO.DEFAULT_ASSEMBLY_DEBUG.msg(`Setting "${key}" context to ${JSON.stringify(value)}`));
  }
}

/**
 * Register a context provider
 *
 * A context provider cannot reuse the SDKs authentication mechanisms.
 */
export function registerContextProvider(name: string, provider: ContextProviderPlugin) {
  availableContextProviders[name] = () => provider;
}

/**
 * Register a plugin context provider
 *
 * A plugin provider cannot reuse the SDKs authentication mechanisms.
 */
export function registerPluginContextProvider(name: string, provider: ContextProviderPlugin) {
  registerContextProvider(`${PLUGIN_PROVIDER_PREFIX}:${name}`, provider);
}

/**
 * Register a context provider factory
 *
 * A context provider factory takes an SdkProvider and returns the context provider plugin.
 */
export function registerContextProviderFactory(name: string, provider: ContextProviderFactory) {
  availableContextProviders[name] = provider;
}

const availableContextProviders: ProviderMap = {
  [cxschema.ContextProvider.AVAILABILITY_ZONE_PROVIDER]: (s, io) => new AZContextProviderPlugin(s, io),
  [cxschema.ContextProvider.SSM_PARAMETER_PROVIDER]: (s, io) => new SSMContextProviderPlugin(s, io),
  [cxschema.ContextProvider.HOSTED_ZONE_PROVIDER]: (s, io) => new HostedZoneContextProviderPlugin(s, io),
  [cxschema.ContextProvider.VPC_PROVIDER]: (s, io) => new VpcNetworkContextProviderPlugin(s, io),
  [cxschema.ContextProvider.AMI_PROVIDER]: (s, io) => new AmiContextProviderPlugin(s, io),
  [cxschema.ContextProvider.ENDPOINT_SERVICE_AVAILABILITY_ZONE_PROVIDER]: (s, io) => new EndpointServiceAZContextProviderPlugin(s, io),
  [cxschema.ContextProvider.SECURITY_GROUP_PROVIDER]: (s) => new SecurityGroupContextProviderPlugin(s),
  [cxschema.ContextProvider.LOAD_BALANCER_PROVIDER]: (s) => new LoadBalancerContextProviderPlugin(s),
  [cxschema.ContextProvider.LOAD_BALANCER_LISTENER_PROVIDER]: (s) => new LoadBalancerListenerContextProviderPlugin(s),
  [cxschema.ContextProvider.KEY_PROVIDER]: (s, io) => new KeyContextProviderPlugin(s, io),
  [cxschema.ContextProvider.CC_API_PROVIDER]: (s) => new CcApiContextProviderPlugin(s),
};
