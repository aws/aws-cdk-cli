"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginHost = exports.TESTING = void 0;
exports.markTesting = markTesting;
const util_1 = require("util");
const context_provider_plugin_1 = require("./context-provider-plugin");
const private_1 = require("../private");
const toolkit_error_1 = require("../toolkit-error");
exports.TESTING = false;
function markTesting() {
    exports.TESTING = true;
}
/**
 * Class to manage a plugin collection
 *
 * It provides a `load()` function that loads a JavaScript
 * module from disk, and gives it access to the `IPluginHost` interface
 * to register itself.
 */
class PluginHost {
    /**
     * Access the currently registered CredentialProviderSources. New sources can
     * be registered using the +registerCredentialProviderSource+ method.
     */
    credentialProviderSources = new Array();
    contextProviderPlugins = {};
    ioHost;
    alreadyLoaded = new Set();
    /**
     * Loads a plug-in into this PluginHost.
     *
     * Will use `require.resolve()` to get the most accurate representation of what
     * code will get loaded in error messages. As such, it will not work in
     * unit tests with Jest virtual modules becauase of <https://github.com/jestjs/jest/issues/9543>.
     *
     * @param moduleSpec the specification (path or name) of the plug-in module to be loaded.
     * @param ioHost the I/O host to use for printing progress information
     */
    load(moduleSpec, ioHost) {
        try {
            const resolved = require.resolve(moduleSpec);
            if (ioHost) {
                new private_1.IoDefaultMessages(private_1.IoHelper.fromIoHost(ioHost, 'init')).debug(`Loading plug-in: ${resolved} from ${moduleSpec}`);
            }
            return this._doLoad(resolved);
        }
        catch (e) {
            // according to Node.js docs `MODULE_NOT_FOUND` is the only possible error here
            // @see https://nodejs.org/api/modules.html#requireresolverequest-options
            // Not using `withCause()` here, since the node error contains a "Require Stack"
            // as part of the error message that is inherently useless to our users.
            throw new toolkit_error_1.ToolkitError(`Unable to resolve plug-in: Cannot find module '${moduleSpec}': ${e}`);
        }
    }
    /**
     * Do the loading given an already-resolved module name
     *
     * @internal
     */
    _doLoad(resolved) {
        try {
            if (this.alreadyLoaded.has(resolved)) {
                return;
            }
            /* eslint-disable @typescript-eslint/no-require-imports */
            const plugin = require(resolved);
            /* eslint-enable */
            if (!isPlugin(plugin)) {
                throw new toolkit_error_1.ToolkitError(`Module ${resolved} is not a valid plug-in, or has an unsupported version.`);
            }
            if (plugin.init) {
                plugin.init(this);
            }
            this.alreadyLoaded.add(resolved);
        }
        catch (e) {
            throw toolkit_error_1.ToolkitError.withCause(`Unable to load plug-in '${resolved}'`, e);
        }
        function isPlugin(x) {
            return x != null && x.version === '1';
        }
    }
    /**
     * Allows plug-ins to register new CredentialProviderSources.
     *
     * @param source a new CredentialProviderSource to register.
     */
    registerCredentialProviderSource(source) {
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
    registerContextProviderAlpha(pluginProviderName, provider) {
        if (!(0, context_provider_plugin_1.isContextProviderPlugin)(provider)) {
            throw new toolkit_error_1.ToolkitError(`Object you gave me does not look like a ContextProviderPlugin: ${(0, util_1.inspect)(provider)}`);
        }
        this.contextProviderPlugins[pluginProviderName] = provider;
    }
}
exports.PluginHost = PluginHost;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9wbHVnaW4vcGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQVNBLGtDQUVDO0FBWEQsK0JBQStCO0FBRS9CLHVFQUFnRztBQUVoRyx3Q0FBeUQ7QUFDekQsb0RBQWdEO0FBRXJDLFFBQUEsT0FBTyxHQUFHLEtBQUssQ0FBQztBQUUzQixTQUFnQixXQUFXO0lBQ3pCLGVBQU8sR0FBRyxJQUFJLENBQUM7QUFDakIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILE1BQWEsVUFBVTtJQUNyQjs7O09BR0c7SUFDYSx5QkFBeUIsR0FBRyxJQUFJLEtBQUssRUFBNEIsQ0FBQztJQUVsRSxzQkFBc0IsR0FBMEMsRUFBRSxDQUFDO0lBRTVFLE1BQU0sQ0FBVztJQUVQLGFBQWEsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBRW5EOzs7Ozs7Ozs7T0FTRztJQUNJLElBQUksQ0FBQyxVQUFrQixFQUFFLE1BQWdCO1FBQzlDLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDN0MsSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDWCxJQUFJLDJCQUFpQixDQUFDLGtCQUFRLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsUUFBUSxTQUFTLFVBQVUsRUFBRSxDQUFDLENBQUM7WUFDdEgsQ0FBQztZQUNELE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNoQyxDQUFDO1FBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztZQUNoQiwrRUFBK0U7WUFDL0UseUVBQXlFO1lBQ3pFLGdGQUFnRjtZQUNoRix3RUFBd0U7WUFDeEUsTUFBTSxJQUFJLDRCQUFZLENBQUMsa0RBQWtELFVBQVUsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ2hHLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNJLE9BQU8sQ0FBQyxRQUFnQjtRQUM3QixJQUFJLENBQUM7WUFDSCxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7Z0JBQ3JDLE9BQU87WUFDVCxDQUFDO1lBRUQsMERBQTBEO1lBQzFELE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNqQyxtQkFBbUI7WUFDbkIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUN0QixNQUFNLElBQUksNEJBQVksQ0FBQyxVQUFVLFFBQVEseURBQXlELENBQUMsQ0FBQztZQUN0RyxDQUFDO1lBQ0QsSUFBSSxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ2hCLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDcEIsQ0FBQztZQUVELElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ25DLENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLE1BQU0sNEJBQVksQ0FBQyxTQUFTLENBQUMsMkJBQTJCLFFBQVEsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQzFFLENBQUM7UUFFRCxTQUFTLFFBQVEsQ0FBQyxDQUFNO1lBQ3RCLE9BQU8sQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLENBQUMsT0FBTyxLQUFLLEdBQUcsQ0FBQztRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxnQ0FBZ0MsQ0FBQyxNQUFnQztRQUN0RSx1REFBdUQ7UUFDdkQsSUFBSSxDQUFDLHlCQUF5QixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUM5QyxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0ErQkc7SUFDSSw0QkFBNEIsQ0FBQyxrQkFBMEIsRUFBRSxRQUErQjtRQUM3RixJQUFJLENBQUMsSUFBQSxpREFBdUIsRUFBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sSUFBSSw0QkFBWSxDQUFDLGtFQUFrRSxJQUFBLGNBQU8sRUFBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDaEgsQ0FBQztRQUNELElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLFFBQVEsQ0FBQztJQUM3RCxDQUFDO0NBQ0Y7QUF0SEQsZ0NBc0hDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgaW5zcGVjdCB9IGZyb20gJ3V0aWwnO1xuaW1wb3J0IHR5cGUgeyBDcmVkZW50aWFsUHJvdmlkZXJTb3VyY2UsIElQbHVnaW5Ib3N0LCBQbHVnaW4gfSBmcm9tICdAYXdzLWNkay9jbGktcGx1Z2luLWNvbnRyYWN0JztcbmltcG9ydCB7IHR5cGUgQ29udGV4dFByb3ZpZGVyUGx1Z2luLCBpc0NvbnRleHRQcm92aWRlclBsdWdpbiB9IGZyb20gJy4vY29udGV4dC1wcm92aWRlci1wbHVnaW4nO1xuaW1wb3J0IHR5cGUgeyBJSW9Ib3N0IH0gZnJvbSAnLi4vaW8nO1xuaW1wb3J0IHsgSW9EZWZhdWx0TWVzc2FnZXMsIElvSGVscGVyIH0gZnJvbSAnLi4vcHJpdmF0ZSc7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcblxuZXhwb3J0IGxldCBURVNUSU5HID0gZmFsc2U7XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXJrVGVzdGluZygpIHtcbiAgVEVTVElORyA9IHRydWU7XG59XG5cbi8qKlxuICogQ2xhc3MgdG8gbWFuYWdlIGEgcGx1Z2luIGNvbGxlY3Rpb25cbiAqXG4gKiBJdCBwcm92aWRlcyBhIGBsb2FkKClgIGZ1bmN0aW9uIHRoYXQgbG9hZHMgYSBKYXZhU2NyaXB0XG4gKiBtb2R1bGUgZnJvbSBkaXNrLCBhbmQgZ2l2ZXMgaXQgYWNjZXNzIHRvIHRoZSBgSVBsdWdpbkhvc3RgIGludGVyZmFjZVxuICogdG8gcmVnaXN0ZXIgaXRzZWxmLlxuICovXG5leHBvcnQgY2xhc3MgUGx1Z2luSG9zdCBpbXBsZW1lbnRzIElQbHVnaW5Ib3N0IHtcbiAgLyoqXG4gICAqIEFjY2VzcyB0aGUgY3VycmVudGx5IHJlZ2lzdGVyZWQgQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlcy4gTmV3IHNvdXJjZXMgY2FuXG4gICAqIGJlIHJlZ2lzdGVyZWQgdXNpbmcgdGhlICtyZWdpc3RlckNyZWRlbnRpYWxQcm92aWRlclNvdXJjZSsgbWV0aG9kLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGNyZWRlbnRpYWxQcm92aWRlclNvdXJjZXMgPSBuZXcgQXJyYXk8Q3JlZGVudGlhbFByb3ZpZGVyU291cmNlPigpO1xuXG4gIHB1YmxpYyByZWFkb25seSBjb250ZXh0UHJvdmlkZXJQbHVnaW5zOiBSZWNvcmQ8c3RyaW5nLCBDb250ZXh0UHJvdmlkZXJQbHVnaW4+ID0ge307XG5cbiAgcHVibGljIGlvSG9zdD86IElJb0hvc3Q7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBhbHJlYWR5TG9hZGVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgLyoqXG4gICAqIExvYWRzIGEgcGx1Zy1pbiBpbnRvIHRoaXMgUGx1Z2luSG9zdC5cbiAgICpcbiAgICogV2lsbCB1c2UgYHJlcXVpcmUucmVzb2x2ZSgpYCB0byBnZXQgdGhlIG1vc3QgYWNjdXJhdGUgcmVwcmVzZW50YXRpb24gb2Ygd2hhdFxuICAgKiBjb2RlIHdpbGwgZ2V0IGxvYWRlZCBpbiBlcnJvciBtZXNzYWdlcy4gQXMgc3VjaCwgaXQgd2lsbCBub3Qgd29yayBpblxuICAgKiB1bml0IHRlc3RzIHdpdGggSmVzdCB2aXJ0dWFsIG1vZHVsZXMgYmVjYXVhc2Ugb2YgPGh0dHBzOi8vZ2l0aHViLmNvbS9qZXN0anMvamVzdC9pc3N1ZXMvOTU0Mz4uXG4gICAqXG4gICAqIEBwYXJhbSBtb2R1bGVTcGVjIHRoZSBzcGVjaWZpY2F0aW9uIChwYXRoIG9yIG5hbWUpIG9mIHRoZSBwbHVnLWluIG1vZHVsZSB0byBiZSBsb2FkZWQuXG4gICAqIEBwYXJhbSBpb0hvc3QgdGhlIEkvTyBob3N0IHRvIHVzZSBmb3IgcHJpbnRpbmcgcHJvZ3Jlc3MgaW5mb3JtYXRpb25cbiAgICovXG4gIHB1YmxpYyBsb2FkKG1vZHVsZVNwZWM6IHN0cmluZywgaW9Ib3N0PzogSUlvSG9zdCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcXVpcmUucmVzb2x2ZShtb2R1bGVTcGVjKTtcbiAgICAgIGlmIChpb0hvc3QpIHtcbiAgICAgICAgbmV3IElvRGVmYXVsdE1lc3NhZ2VzKElvSGVscGVyLmZyb21Jb0hvc3QoaW9Ib3N0LCAnaW5pdCcpKS5kZWJ1ZyhgTG9hZGluZyBwbHVnLWluOiAke3Jlc29sdmVkfSBmcm9tICR7bW9kdWxlU3BlY31gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzLl9kb0xvYWQocmVzb2x2ZWQpO1xuICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgLy8gYWNjb3JkaW5nIHRvIE5vZGUuanMgZG9jcyBgTU9EVUxFX05PVF9GT1VORGAgaXMgdGhlIG9ubHkgcG9zc2libGUgZXJyb3IgaGVyZVxuICAgICAgLy8gQHNlZSBodHRwczovL25vZGVqcy5vcmcvYXBpL21vZHVsZXMuaHRtbCNyZXF1aXJlcmVzb2x2ZXJlcXVlc3Qtb3B0aW9uc1xuICAgICAgLy8gTm90IHVzaW5nIGB3aXRoQ2F1c2UoKWAgaGVyZSwgc2luY2UgdGhlIG5vZGUgZXJyb3IgY29udGFpbnMgYSBcIlJlcXVpcmUgU3RhY2tcIlxuICAgICAgLy8gYXMgcGFydCBvZiB0aGUgZXJyb3IgbWVzc2FnZSB0aGF0IGlzIGluaGVyZW50bHkgdXNlbGVzcyB0byBvdXIgdXNlcnMuXG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBVbmFibGUgdG8gcmVzb2x2ZSBwbHVnLWluOiBDYW5ub3QgZmluZCBtb2R1bGUgJyR7bW9kdWxlU3BlY30nOiAke2V9YCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERvIHRoZSBsb2FkaW5nIGdpdmVuIGFuIGFscmVhZHktcmVzb2x2ZWQgbW9kdWxlIG5hbWVcbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwdWJsaWMgX2RvTG9hZChyZXNvbHZlZDogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLmFscmVhZHlMb2FkZWQuaGFzKHJlc29sdmVkKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8qIGVzbGludC1kaXNhYmxlIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHMgKi9cbiAgICAgIGNvbnN0IHBsdWdpbiA9IHJlcXVpcmUocmVzb2x2ZWQpO1xuICAgICAgLyogZXNsaW50LWVuYWJsZSAqL1xuICAgICAgaWYgKCFpc1BsdWdpbihwbHVnaW4pKSB7XG4gICAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYE1vZHVsZSAke3Jlc29sdmVkfSBpcyBub3QgYSB2YWxpZCBwbHVnLWluLCBvciBoYXMgYW4gdW5zdXBwb3J0ZWQgdmVyc2lvbi5gKTtcbiAgICAgIH1cbiAgICAgIGlmIChwbHVnaW4uaW5pdCkge1xuICAgICAgICBwbHVnaW4uaW5pdCh0aGlzKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5hbHJlYWR5TG9hZGVkLmFkZChyZXNvbHZlZCk7XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICB0aHJvdyBUb29sa2l0RXJyb3Iud2l0aENhdXNlKGBVbmFibGUgdG8gbG9hZCBwbHVnLWluICcke3Jlc29sdmVkfSdgLCBlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc1BsdWdpbih4OiBhbnkpOiB4IGlzIFBsdWdpbiB7XG4gICAgICByZXR1cm4geCAhPSBudWxsICYmIHgudmVyc2lvbiA9PT0gJzEnO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBbGxvd3MgcGx1Zy1pbnMgdG8gcmVnaXN0ZXIgbmV3IENyZWRlbnRpYWxQcm92aWRlclNvdXJjZXMuXG4gICAqXG4gICAqIEBwYXJhbSBzb3VyY2UgYSBuZXcgQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlIHRvIHJlZ2lzdGVyLlxuICAgKi9cbiAgcHVibGljIHJlZ2lzdGVyQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlKHNvdXJjZTogQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlKSB7XG4gICAgLy8gRm9yd2FyZCB0byB0aGUgcmlnaHQgY3JlZGVudGlhbHMtcmVsYXRlZCBwbHVnaW4gaG9zdFxuICAgIHRoaXMuY3JlZGVudGlhbFByb3ZpZGVyU291cmNlcy5wdXNoKHNvdXJjZSk7XG4gIH1cblxuICAvKipcbiAgICogKEVYUEVSSU1FTlRBTCkgQWxsb3cgcGx1Z2lucyB0byByZWdpc3RlciBjb250ZXh0IHByb3ZpZGVyc1xuICAgKlxuICAgKiBDb250ZXh0IHByb3ZpZGVycyBhcmUgb2JqZWN0cyB3aXRoIHRoZSBmb2xsb3dpbmcgbWV0aG9kOlxuICAgKlxuICAgKiBgYGB0c1xuICAgKiAgIGdldFZhbHVlKGFyZ3M6IHtba2V5OiBzdHJpbmddOiBhbnl9KTogUHJvbWlzZTxhbnk+O1xuICAgKiBgYGBcbiAgICpcbiAgICogQ3VycmVudGx5LCB0aGV5IGNhbm5vdCByZXVzZSB0aGUgQ0RLJ3MgYXV0aGVudGljYXRpb24gbWVjaGFuaXNtcywgc28gdGhleVxuICAgKiBtdXN0IGJlIHByZXBhcmVkIHRvIGVpdGhlciBub3QgbWFrZSBBV1MgY2FsbHMgb3IgdXNlIHRoZWlyIG93biBzb3VyY2Ugb2ZcbiAgICogQVdTIGNyZWRlbnRpYWxzLlxuICAgKlxuICAgKiBUaGlzIGZlYXR1cmUgaXMgZXhwZXJpbWVudGFsLCBhbmQgb25seSBpbnRlbmRlZCB0byBiZSB1c2VkIGludGVybmFsbHkgYXQgQW1hem9uXG4gICAqIGFzIGEgdHJpYWwuXG4gICAqXG4gICAqIEFmdGVyIHJlZ2lzdGVyaW5nIHdpdGggJ215LXBsdWdpbi1uYW1lJywgdGhlIHByb3ZpZGVyIG11c3QgYmUgYWRkcmVzc2VkIGFzIGZvbGxvd3M6XG4gICAqXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IHZhbHVlID0gQ29udGV4dFByb3ZpZGVyLmdldFZhbHVlKHRoaXMsIHtcbiAgICogICBwcm92aWRlck5hbWU6ICdwbHVnaW4nLFxuICAgKiAgIHByb3BzOiB7XG4gICAqICAgICBwbHVnaW5OYW1lOiAnbXktcGx1Z2luLW5hbWUnLFxuICAgKiAgICAgbXlQYXJhbWV0ZXIxOiAneHl6JyxcbiAgICogICB9LFxuICAgKiAgIGluY2x1ZGVFbnZpcm9ubWVudDogdHJ1ZSB8IGZhbHNlLFxuICAgKiAgIGR1bW15VmFsdWU6ICd3aGF0LXRvLXJldHVybi1vbi10aGUtZmlyc3QtcGFzcycsXG4gICAqIH0pXG4gICAqIGBgYFxuICAgKlxuICAgKiBAZXhwZXJpbWVudGFsXG4gICAqL1xuICBwdWJsaWMgcmVnaXN0ZXJDb250ZXh0UHJvdmlkZXJBbHBoYShwbHVnaW5Qcm92aWRlck5hbWU6IHN0cmluZywgcHJvdmlkZXI6IENvbnRleHRQcm92aWRlclBsdWdpbikge1xuICAgIGlmICghaXNDb250ZXh0UHJvdmlkZXJQbHVnaW4ocHJvdmlkZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBPYmplY3QgeW91IGdhdmUgbWUgZG9lcyBub3QgbG9vayBsaWtlIGEgQ29udGV4dFByb3ZpZGVyUGx1Z2luOiAke2luc3BlY3QocHJvdmlkZXIpfWApO1xuICAgIH1cbiAgICB0aGlzLmNvbnRleHRQcm92aWRlclBsdWdpbnNbcGx1Z2luUHJvdmlkZXJOYW1lXSA9IHByb3ZpZGVyO1xuICB9XG59XG4iXX0=