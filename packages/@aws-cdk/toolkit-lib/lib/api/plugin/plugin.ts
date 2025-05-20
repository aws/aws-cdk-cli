import { inspect } from 'util';
import type { CredentialProviderSource, IPluginHost, Plugin } from '@aws-cdk/cli-plugin-contract';
import { type ContextProviderPlugin, isContextProviderPlugin } from './context-provider-plugin';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { IIoHost } from '../io';
import { IoHelper } from '../io/private';

/**
 * Class to manage a plugin collection
 *
 * It provides a `load()` function that loads a JavaScript
 * module from disk, and gives it access to the `IPluginHost` interface
 * to register itself.
 */
export class PluginHost implements IPluginHost {
  /**
   * Access the currently registered CredentialProviderSources. New sources can
   * be registered using the +registerCredentialProviderSource+ method.
   */
  public readonly credentialProviderSources = new Array<CredentialProviderSource>();

  public readonly contextProviderPlugins: Record<string, ContextProviderPlugin> = {};

  public ioHost?: IIoHost;

  private readonly alreadyLoaded = new Set<string>();

  /**
   * Loads a plug-in into this PluginHost.
   *
   * Will use `require.resolve()` to get the most accurate representation of what
   * code will get loaded in error messages. As such, it will not work in
   * unit tests with Jest virtual modules becauase of \<https://github.com/jestjs/jest/issues/9543\>.
   *
   * @param moduleSpec - the specification (path or name) of the plug-in module to be loaded.
   * @param ioHost - the I/O host to use for printing progress information
   */
  public async load(moduleSpec: string, ioHost?: IIoHost) {
    try {
      const resolved = require.resolve(moduleSpec);
      if (ioHost) {
        await IoHelper.fromIoHost(ioHost, 'init').defaults.debug(`Loading plug-in: ${resolved} from ${moduleSpec}`);
      }
      return this._doLoad(resolved);
    } catch (e: any) {
      // according to Node.js docs `MODULE_NOT_FOUND` is the only possible error here
      // @see https://nodejs.org/api/modules.html#requireresolverequest-options
      // Not using `withCause()` here, since the node error contains a "Require Stack"
      // as part of the error message that is inherently useless to our users.
      throw new ToolkitError(`Unable to resolve plug-in: Cannot find module '${moduleSpec}': ${e}`);
    }
  }

  /**
   * Do the loading given an already-resolved module name
   *
   * @internal
   */
  public _doLoad(resolved: string) {
    try {
      if (this.alreadyLoaded.has(resolved)) {
        return;
      }

      /* eslint-disable @typescript-eslint/no-require-imports */
      const plugin = require(resolved);
      /* eslint-enable */
      if (!isPlugin(plugin)) {
        throw new ToolkitError(`Module ${resolved} is not a valid plug-in, or has an unsupported version.`);
      }
      if (plugin.init) {
        plugin.init(this);
      }

      this.alreadyLoaded.add(resolved);
    } catch (e: any) {
      throw ToolkitError.withCause(`Unable to load plug-in '${resolved}'`, e);
    }

    function isPlugin(x: any): x is Plugin {
      return x != null && x.version === '1';
    }
  }

  /**
   * Allows plug-ins to register new CredentialProviderSources.
   *
   * @param source - a new CredentialProviderSource to register.
   */
  public registerCredentialProviderSource(source: CredentialProviderSource) {
    // Forward to the right credentials-related plugin host
    this.credentialProviderSources.push(source);
  }

  /**
   * (EXPERIMENTAL) Allow plugins to register context providers
   *
   * Context providers are objects with the following method:
   *
   * ```ts
   *   getValue(args: {[key: string]: any}): Promise<any>;
   * ```
   *
   * Currently, they cannot reuse the CDK's authentication mechanisms, so they
   * must be prepared to either not make AWS calls or use their own source of
   * AWS credentials.
   *
   * This feature is experimental, and only intended to be used internally at Amazon
   * as a trial.
   *
   * After registering with 'my-plugin-name', the provider must be addressed as follows:
   *
   * ```ts
   * const value = ContextProvider.getValue(this, {
   *   providerName: 'plugin',
   *   props: {
   *     pluginName: 'my-plugin-name',
   *     myParameter1: 'xyz',
   *   },
   *   includeEnvironment: true | false,
   *   dummyValue: 'what-to-return-on-the-first-pass',
   * })
   * ```
   *
   * @experimental
   */
  public registerContextProviderAlpha(pluginProviderName: string, provider: ContextProviderPlugin) {
    if (!isContextProviderPlugin(provider)) {
      throw new ToolkitError(`Object you gave me does not look like a ContextProviderPlugin: ${inspect(provider)}`);
    }
    this.contextProviderPlugins[pluginProviderName] = provider;
  }
}
