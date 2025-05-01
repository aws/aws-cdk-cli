"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvironmentAccess = void 0;
const toolkit_error_1 = require("../toolkit-error");
const environment_resources_1 = require("./environment-resources");
const placeholders_1 = require("./placeholders");
const util_1 = require("../../util");
const private_1 = require("../io/private");
const plugin_1 = require("../plugin");
/**
 * Access particular AWS resources, based on information from the CX manifest
 *
 * It is not possible to grab direct access to AWS credentials; 9 times out of 10
 * we have to allow for role assumption, and role assumption can only work if
 * there is a CX Manifest that contains a role ARN.
 *
 * This class exists so new code isn't tempted to go and get SDK credentials directly.
 */
class EnvironmentAccess {
    sdkProvider;
    sdkCache = new Map();
    environmentResources;
    ioHelper;
    constructor(sdkProvider, toolkitStackName, ioHelper) {
        this.sdkProvider = sdkProvider;
        this.environmentResources = new environment_resources_1.EnvironmentResourcesRegistry(toolkitStackName);
        this.ioHelper = ioHelper;
    }
    /**
     * Resolves the environment for a stack.
     */
    async resolveStackEnvironment(stack) {
        return this.sdkProvider.resolveEnvironment(stack.environment);
    }
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will ask plugins for readonly credentials if available, use the default
     * AWS credentials if not.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    async accessStackForReadOnlyStackOperations(stack) {
        return this.accessStackForStackOperations(stack, plugin_1.Mode.ForReading);
    }
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will ask plugins for mutating credentials if available, use the default AWS
     * credentials if not.  The `mode` parameter is only used for querying
     * plugins.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    async accessStackForMutableStackOperations(stack) {
        return this.accessStackForStackOperations(stack, plugin_1.Mode.ForWriting);
    }
    /**
     * Get an SDK to access the given stack's environment for environmental lookups
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will assume the lookup role if configured on the stack. Check the default `lookup-role`
     * policies to see what you can do with this role. It can generally read everything
     * in the account that does not require KMS access.
     *
     * ---
     *
     * For backwards compatibility reasons, there are some scenarios that are handled here:
     *
     *  1. The lookup role may not exist (it was added in bootstrap stack version 7). If so:
     *     a. Return the default credentials if the default credentials are for the stack account
     *        (you will notice this as `isFallbackCredentials=true`).
     *     b. Throw an error if the default credentials are not for the stack account.
     *
     *  2. The lookup role may not have the correct permissions (for example, ReadOnlyAccess was added in
     *     bootstrap stack version 8); the stack will have a minimum version number on it.
     *     a. If it does not we throw an error which should be handled in the calling
     *        function (and fallback to use a different role, etc)
     *
     * Upon success, caller will have an SDK for the right account, which may or may not have
     * the right permissions.
     */
    async accessStackForLookup(stack) {
        if (!stack.environment) {
            throw new toolkit_error_1.ToolkitError(`The stack ${stack.displayName} does not have an environment`);
        }
        const lookupEnv = await this.prepareSdk({
            environment: stack.environment,
            mode: plugin_1.Mode.ForReading,
            assumeRoleArn: stack.lookupRole?.arn,
            assumeRoleExternalId: stack.lookupRole?.assumeRoleExternalId,
            assumeRoleAdditionalOptions: stack.lookupRole?.assumeRoleAdditionalOptions,
        });
        // if we succeed in assuming the lookup role, make sure we have the correct bootstrap stack version
        if (lookupEnv.didAssumeRole && stack.lookupRole?.bootstrapStackVersionSsmParameter && stack.lookupRole.requiresBootstrapStackVersion) {
            const version = await lookupEnv.resources.versionFromSsmParameter(stack.lookupRole.bootstrapStackVersionSsmParameter);
            if (version < stack.lookupRole.requiresBootstrapStackVersion) {
                throw new toolkit_error_1.ToolkitError(`Bootstrap stack version '${stack.lookupRole.requiresBootstrapStackVersion}' is required, found version '${version}'. To get rid of this error, please upgrade to bootstrap version >= ${stack.lookupRole.requiresBootstrapStackVersion}`);
            }
        }
        if (lookupEnv.isFallbackCredentials) {
            const arn = await lookupEnv.replacePlaceholders(stack.lookupRole?.arn);
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Lookup role ${arn} was not assumed. Proceeding with default credentials.`));
        }
        return lookupEnv;
    }
    /**
     * Get an SDK to access the given stack's environment for reading stack attributes
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will try to assume the lookup role if given, will use the regular stack operations
     * access (deploy-role) otherwise. When calling this, you should assume that you will get
     * the least privileged role, so don't try to use it for anything the `deploy-role`
     * wouldn't be able to do. Also you cannot rely on being able to read encrypted anything.
     */
    async accessStackForLookupBestEffort(stack) {
        if (!stack.environment) {
            throw new toolkit_error_1.ToolkitError(`The stack ${stack.displayName} does not have an environment`);
        }
        try {
            return await this.accessStackForLookup(stack);
        }
        catch (e) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`${(0, util_1.formatErrorMessage)(e)}`));
        }
        return this.accessStackForStackOperations(stack, plugin_1.Mode.ForReading);
    }
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    async accessStackForStackOperations(stack, mode) {
        if (!stack.environment) {
            throw new toolkit_error_1.ToolkitError(`The stack ${stack.displayName} does not have an environment`);
        }
        return this.prepareSdk({
            environment: stack.environment,
            mode,
            assumeRoleArn: stack.assumeRoleArn,
            assumeRoleExternalId: stack.assumeRoleExternalId,
            assumeRoleAdditionalOptions: stack.assumeRoleAdditionalOptions,
        });
    }
    /**
     * Prepare an SDK for use in the given environment and optionally with a role assumed.
     */
    async prepareSdk(options) {
        const resolvedEnvironment = await this.sdkProvider.resolveEnvironment(options.environment);
        // Substitute any placeholders with information about the current environment
        const { assumeRoleArn } = await (0, placeholders_1.replaceEnvPlaceholders)({
            assumeRoleArn: options.assumeRoleArn,
        }, resolvedEnvironment, this.sdkProvider);
        const stackSdk = await this.cachedSdkForEnvironment(resolvedEnvironment, options.mode, {
            assumeRoleArn,
            assumeRoleExternalId: options.assumeRoleExternalId,
            assumeRoleAdditionalOptions: options.assumeRoleAdditionalOptions,
        });
        return {
            sdk: stackSdk.sdk,
            resolvedEnvironment,
            resources: this.environmentResources.for(resolvedEnvironment, stackSdk.sdk, this.ioHelper),
            // If we asked for a role, did not successfully assume it, and yet got here without an exception: that
            // means we must have fallback credentials.
            isFallbackCredentials: !stackSdk.didAssumeRole && !!assumeRoleArn,
            didAssumeRole: stackSdk.didAssumeRole,
            replacePlaceholders: async (str) => {
                const ret = await (0, placeholders_1.replaceEnvPlaceholders)({ str }, resolvedEnvironment, this.sdkProvider);
                return ret.str;
            },
        };
    }
    async cachedSdkForEnvironment(environment, mode, options) {
        const cacheKeyElements = [
            environment.account,
            environment.region,
            `${mode}`,
            options?.assumeRoleArn ?? '',
            options?.assumeRoleExternalId ?? '',
        ];
        if (options?.assumeRoleAdditionalOptions) {
            cacheKeyElements.push(JSON.stringify(options.assumeRoleAdditionalOptions));
        }
        const cacheKey = cacheKeyElements.join(':');
        const existing = this.sdkCache.get(cacheKey);
        if (existing) {
            return existing;
        }
        const ret = await this.sdkProvider.forEnvironment(environment, mode, options);
        this.sdkCache.set(cacheKey, ret);
        return ret;
    }
}
exports.EnvironmentAccess = EnvironmentAccess;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW52aXJvbm1lbnQtYWNjZXNzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9lbnZpcm9ubWVudC9lbnZpcm9ubWVudC1hY2Nlc3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0Esb0RBQWdEO0FBRWhELG1FQUF1RTtBQUV2RSxpREFBd0Q7QUFDeEQscUNBQWdEO0FBRWhELDJDQUFrRDtBQUNsRCxzQ0FBaUM7QUFFakM7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFhLGlCQUFpQjtJQUtDO0lBSlosUUFBUSxHQUFHLElBQUksR0FBRyxFQUE2QixDQUFDO0lBQ2hELG9CQUFvQixDQUErQjtJQUNuRCxRQUFRLENBQVc7SUFFcEMsWUFBNkIsV0FBd0IsRUFBRSxnQkFBd0IsRUFBRSxRQUFrQjtRQUF0RSxnQkFBVyxHQUFYLFdBQVcsQ0FBYTtRQUNuRCxJQUFJLENBQUMsb0JBQW9CLEdBQUcsSUFBSSxvREFBNEIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQy9FLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzNCLENBQUM7SUFFRDs7T0FFRztJQUNJLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxLQUF3QztRQUMzRSxPQUFPLElBQUksQ0FBQyxXQUFXLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQ2hFLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNJLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxLQUF3QztRQUN6RixPQUFPLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLLEVBQUUsYUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ3BFLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsS0FBd0M7UUFDeEYsT0FBTyxJQUFJLENBQUMsNkJBQTZCLENBQUMsS0FBSyxFQUFFLGFBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUNwRSxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09BMEJHO0lBQ0ksS0FBSyxDQUFDLG9CQUFvQixDQUFDLEtBQXdDO1FBQ3hFLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDdkIsTUFBTSxJQUFJLDRCQUFZLENBQUMsYUFBYSxLQUFLLENBQUMsV0FBVywrQkFBK0IsQ0FBQyxDQUFDO1FBQ3hGLENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUM7WUFDdEMsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO1lBQzlCLElBQUksRUFBRSxhQUFJLENBQUMsVUFBVTtZQUNyQixhQUFhLEVBQUUsS0FBSyxDQUFDLFVBQVUsRUFBRSxHQUFHO1lBQ3BDLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxVQUFVLEVBQUUsb0JBQW9CO1lBQzVELDJCQUEyQixFQUFFLEtBQUssQ0FBQyxVQUFVLEVBQUUsMkJBQTJCO1NBQzNFLENBQUMsQ0FBQztRQUVILG1HQUFtRztRQUNuRyxJQUFJLFNBQVMsQ0FBQyxhQUFhLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRSxpQ0FBaUMsSUFBSSxLQUFLLENBQUMsVUFBVSxDQUFDLDZCQUE2QixFQUFFLENBQUM7WUFDckksTUFBTSxPQUFPLEdBQUcsTUFBTSxTQUFTLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsaUNBQWlDLENBQUMsQ0FBQztZQUN0SCxJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsVUFBVSxDQUFDLDZCQUE2QixFQUFFLENBQUM7Z0JBQzdELE1BQU0sSUFBSSw0QkFBWSxDQUFDLDRCQUE0QixLQUFLLENBQUMsVUFBVSxDQUFDLDZCQUE2QixpQ0FBaUMsT0FBTyx1RUFBdUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyw2QkFBNkIsRUFBRSxDQUFDLENBQUM7WUFDcFEsQ0FBQztRQUNILENBQUM7UUFDRCxJQUFJLFNBQVMsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBQ3BDLE1BQU0sR0FBRyxHQUFHLE1BQU0sU0FBUyxDQUFDLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDdkUsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxZQUFFLENBQUMsb0JBQW9CLENBQUMsR0FBRyxDQUFDLGVBQWUsR0FBRyx3REFBd0QsQ0FBQyxDQUFDLENBQUM7UUFDdEksQ0FBQztRQUNELE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0ksS0FBSyxDQUFDLDhCQUE4QixDQUFDLEtBQXdDO1FBQ2xGLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDdkIsTUFBTSxJQUFJLDRCQUFZLENBQUMsYUFBYSxLQUFLLENBQUMsV0FBVywrQkFBK0IsQ0FBQyxDQUFDO1FBQ3hGLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxPQUFPLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2hELENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsWUFBRSxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUEseUJBQWtCLEVBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDdEYsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLDZCQUE2QixDQUFDLEtBQUssRUFBRSxhQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7SUFDcEUsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0ssS0FBSyxDQUFDLDZCQUE2QixDQUFDLEtBQXdDLEVBQUUsSUFBVTtRQUM5RixJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSw0QkFBWSxDQUFDLGFBQWEsS0FBSyxDQUFDLFdBQVcsK0JBQStCLENBQUMsQ0FBQztRQUN4RixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDO1lBQ3JCLFdBQVcsRUFBRSxLQUFLLENBQUMsV0FBVztZQUM5QixJQUFJO1lBQ0osYUFBYSxFQUFFLEtBQUssQ0FBQyxhQUFhO1lBQ2xDLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxvQkFBb0I7WUFDaEQsMkJBQTJCLEVBQUUsS0FBSyxDQUFDLDJCQUEyQjtTQUMvRCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxLQUFLLENBQUMsVUFBVSxDQUN0QixPQUE4QjtRQUU5QixNQUFNLG1CQUFtQixHQUFHLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxrQkFBa0IsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7UUFFM0YsNkVBQTZFO1FBQzdFLE1BQU0sRUFBRSxhQUFhLEVBQUUsR0FBRyxNQUFNLElBQUEscUNBQXNCLEVBQUM7WUFDckQsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO1NBQ3JDLEVBQUUsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRTFDLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLG1CQUFtQixFQUFFLE9BQU8sQ0FBQyxJQUFJLEVBQUU7WUFDckYsYUFBYTtZQUNiLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxvQkFBb0I7WUFDbEQsMkJBQTJCLEVBQUUsT0FBTyxDQUFDLDJCQUEyQjtTQUNqRSxDQUFDLENBQUM7UUFFSCxPQUFPO1lBQ0wsR0FBRyxFQUFFLFFBQVEsQ0FBQyxHQUFHO1lBQ2pCLG1CQUFtQjtZQUNuQixTQUFTLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsRUFBRSxRQUFRLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUM7WUFDMUYsc0dBQXNHO1lBQ3RHLDJDQUEyQztZQUMzQyxxQkFBcUIsRUFBRSxDQUFDLFFBQVEsQ0FBQyxhQUFhLElBQUksQ0FBQyxDQUFDLGFBQWE7WUFDakUsYUFBYSxFQUFFLFFBQVEsQ0FBQyxhQUFhO1lBQ3JDLG1CQUFtQixFQUFFLEtBQUssRUFBZ0MsR0FBTSxFQUFFLEVBQUU7Z0JBQ2xFLE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBQSxxQ0FBc0IsRUFBQyxFQUFFLEdBQUcsRUFBRSxFQUFFLG1CQUFtQixFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztnQkFDekYsT0FBTyxHQUFHLENBQUMsR0FBRyxDQUFDO1lBQ2pCLENBQUM7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVPLEtBQUssQ0FBQyx1QkFBdUIsQ0FDbkMsV0FBOEIsRUFDOUIsSUFBVSxFQUNWLE9BQTRCO1FBRTVCLE1BQU0sZ0JBQWdCLEdBQUc7WUFDdkIsV0FBVyxDQUFDLE9BQU87WUFDbkIsV0FBVyxDQUFDLE1BQU07WUFDbEIsR0FBRyxJQUFJLEVBQUU7WUFDVCxPQUFPLEVBQUUsYUFBYSxJQUFJLEVBQUU7WUFDNUIsT0FBTyxFQUFFLG9CQUFvQixJQUFJLEVBQUU7U0FDcEMsQ0FBQztRQUVGLElBQUksT0FBTyxFQUFFLDJCQUEyQixFQUFFLENBQUM7WUFDekMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLDJCQUEyQixDQUFDLENBQUMsQ0FBQztRQUM3RSxDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzVDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzdDLElBQUksUUFBUSxFQUFFLENBQUM7WUFDYixPQUFPLFFBQVEsQ0FBQztRQUNsQixDQUFDO1FBQ0QsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLGNBQWMsQ0FBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQzlFLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUNqQyxPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUM7Q0FDRjtBQTdNRCw4Q0E2TUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcbmltcG9ydCB0eXBlIHsgRW52aXJvbm1lbnRSZXNvdXJjZXMgfSBmcm9tICcuL2Vudmlyb25tZW50LXJlc291cmNlcyc7XG5pbXBvcnQgeyBFbnZpcm9ubWVudFJlc291cmNlc1JlZ2lzdHJ5IH0gZnJvbSAnLi9lbnZpcm9ubWVudC1yZXNvdXJjZXMnO1xuaW1wb3J0IHR5cGUgeyBTdHJpbmdXaXRob3V0UGxhY2Vob2xkZXJzIH0gZnJvbSAnLi9wbGFjZWhvbGRlcnMnO1xuaW1wb3J0IHsgcmVwbGFjZUVudlBsYWNlaG9sZGVycyB9IGZyb20gJy4vcGxhY2Vob2xkZXJzJztcbmltcG9ydCB7IGZvcm1hdEVycm9yTWVzc2FnZSB9IGZyb20gJy4uLy4uL3V0aWwnO1xuaW1wb3J0IHR5cGUgeyBTREssIENyZWRlbnRpYWxzT3B0aW9ucywgU2RrRm9yRW52aXJvbm1lbnQsIFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHsgSU8sIHR5cGUgSW9IZWxwZXIgfSBmcm9tICcuLi9pby9wcml2YXRlJztcbmltcG9ydCB7IE1vZGUgfSBmcm9tICcuLi9wbHVnaW4nO1xuXG4vKipcbiAqIEFjY2VzcyBwYXJ0aWN1bGFyIEFXUyByZXNvdXJjZXMsIGJhc2VkIG9uIGluZm9ybWF0aW9uIGZyb20gdGhlIENYIG1hbmlmZXN0XG4gKlxuICogSXQgaXMgbm90IHBvc3NpYmxlIHRvIGdyYWIgZGlyZWN0IGFjY2VzcyB0byBBV1MgY3JlZGVudGlhbHM7IDkgdGltZXMgb3V0IG9mIDEwXG4gKiB3ZSBoYXZlIHRvIGFsbG93IGZvciByb2xlIGFzc3VtcHRpb24sIGFuZCByb2xlIGFzc3VtcHRpb24gY2FuIG9ubHkgd29yayBpZlxuICogdGhlcmUgaXMgYSBDWCBNYW5pZmVzdCB0aGF0IGNvbnRhaW5zIGEgcm9sZSBBUk4uXG4gKlxuICogVGhpcyBjbGFzcyBleGlzdHMgc28gbmV3IGNvZGUgaXNuJ3QgdGVtcHRlZCB0byBnbyBhbmQgZ2V0IFNESyBjcmVkZW50aWFscyBkaXJlY3RseS5cbiAqL1xuZXhwb3J0IGNsYXNzIEVudmlyb25tZW50QWNjZXNzIHtcbiAgcHJpdmF0ZSByZWFkb25seSBzZGtDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBTZGtGb3JFbnZpcm9ubWVudD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBlbnZpcm9ubWVudFJlc291cmNlczogRW52aXJvbm1lbnRSZXNvdXJjZXNSZWdpc3RyeTtcbiAgcHJpdmF0ZSByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBzZGtQcm92aWRlcjogU2RrUHJvdmlkZXIsIHRvb2xraXRTdGFja05hbWU6IHN0cmluZywgaW9IZWxwZXI6IElvSGVscGVyKSB7XG4gICAgdGhpcy5lbnZpcm9ubWVudFJlc291cmNlcyA9IG5ldyBFbnZpcm9ubWVudFJlc291cmNlc1JlZ2lzdHJ5KHRvb2xraXRTdGFja05hbWUpO1xuICAgIHRoaXMuaW9IZWxwZXIgPSBpb0hlbHBlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZW52aXJvbm1lbnQgZm9yIGEgc3RhY2suXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcmVzb2x2ZVN0YWNrRW52aXJvbm1lbnQoc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCk6IFByb21pc2U8Y3hhcGkuRW52aXJvbm1lbnQ+IHtcbiAgICByZXR1cm4gdGhpcy5zZGtQcm92aWRlci5yZXNvbHZlRW52aXJvbm1lbnQoc3RhY2suZW52aXJvbm1lbnQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBhbiBTREsgdG8gYWNjZXNzIHRoZSBnaXZlbiBzdGFjaydzIGVudmlyb25tZW50IGZvciBzdGFjayBvcGVyYXRpb25zXG4gICAqXG4gICAqIFdpbGwgYXNrIHBsdWdpbnMgZm9yIHJlYWRvbmx5IGNyZWRlbnRpYWxzIGlmIGF2YWlsYWJsZSwgdXNlIHRoZSBkZWZhdWx0XG4gICAqIEFXUyBjcmVkZW50aWFscyBpZiBub3QuXG4gICAqXG4gICAqIFdpbGwgYXNzdW1lIHRoZSBkZXBsb3kgcm9sZSBpZiBjb25maWd1cmVkIG9uIHRoZSBzdGFjay4gQ2hlY2sgdGhlIGRlZmF1bHQgYGRlcGxveS1yb2xlYFxuICAgKiBwb2xpY2llcyB0byBzZWUgd2hhdCB5b3UgY2FuIGRvIHdpdGggdGhpcyByb2xlLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIGFjY2Vzc1N0YWNrRm9yUmVhZE9ubHlTdGFja09wZXJhdGlvbnMoc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCk6IFByb21pc2U8VGFyZ2V0RW52aXJvbm1lbnQ+IHtcbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NTdGFja0ZvclN0YWNrT3BlcmF0aW9ucyhzdGFjaywgTW9kZS5Gb3JSZWFkaW5nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYW4gU0RLIHRvIGFjY2VzcyB0aGUgZ2l2ZW4gc3RhY2sncyBlbnZpcm9ubWVudCBmb3Igc3RhY2sgb3BlcmF0aW9uc1xuICAgKlxuICAgKiBXaWxsIGFzayBwbHVnaW5zIGZvciBtdXRhdGluZyBjcmVkZW50aWFscyBpZiBhdmFpbGFibGUsIHVzZSB0aGUgZGVmYXVsdCBBV1NcbiAgICogY3JlZGVudGlhbHMgaWYgbm90LiAgVGhlIGBtb2RlYCBwYXJhbWV0ZXIgaXMgb25seSB1c2VkIGZvciBxdWVyeWluZ1xuICAgKiBwbHVnaW5zLlxuICAgKlxuICAgKiBXaWxsIGFzc3VtZSB0aGUgZGVwbG95IHJvbGUgaWYgY29uZmlndXJlZCBvbiB0aGUgc3RhY2suIENoZWNrIHRoZSBkZWZhdWx0IGBkZXBsb3ktcm9sZWBcbiAgICogcG9saWNpZXMgdG8gc2VlIHdoYXQgeW91IGNhbiBkbyB3aXRoIHRoaXMgcm9sZS5cbiAgICovXG4gIHB1YmxpYyBhc3luYyBhY2Nlc3NTdGFja0Zvck11dGFibGVTdGFja09wZXJhdGlvbnMoc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCk6IFByb21pc2U8VGFyZ2V0RW52aXJvbm1lbnQ+IHtcbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NTdGFja0ZvclN0YWNrT3BlcmF0aW9ucyhzdGFjaywgTW9kZS5Gb3JXcml0aW5nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYW4gU0RLIHRvIGFjY2VzcyB0aGUgZ2l2ZW4gc3RhY2sncyBlbnZpcm9ubWVudCBmb3IgZW52aXJvbm1lbnRhbCBsb29rdXBzXG4gICAqXG4gICAqIFdpbGwgdXNlIGEgcGx1Z2luIGlmIGF2YWlsYWJsZSwgdXNlIHRoZSBkZWZhdWx0IEFXUyBjcmVkZW50aWFscyBpZiBub3QuXG4gICAqIFRoZSBgbW9kZWAgcGFyYW1ldGVyIGlzIG9ubHkgdXNlZCBmb3IgcXVlcnlpbmcgcGx1Z2lucy5cbiAgICpcbiAgICogV2lsbCBhc3N1bWUgdGhlIGxvb2t1cCByb2xlIGlmIGNvbmZpZ3VyZWQgb24gdGhlIHN0YWNrLiBDaGVjayB0aGUgZGVmYXVsdCBgbG9va3VwLXJvbGVgXG4gICAqIHBvbGljaWVzIHRvIHNlZSB3aGF0IHlvdSBjYW4gZG8gd2l0aCB0aGlzIHJvbGUuIEl0IGNhbiBnZW5lcmFsbHkgcmVhZCBldmVyeXRoaW5nXG4gICAqIGluIHRoZSBhY2NvdW50IHRoYXQgZG9lcyBub3QgcmVxdWlyZSBLTVMgYWNjZXNzLlxuICAgKlxuICAgKiAtLS1cbiAgICpcbiAgICogRm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5IHJlYXNvbnMsIHRoZXJlIGFyZSBzb21lIHNjZW5hcmlvcyB0aGF0IGFyZSBoYW5kbGVkIGhlcmU6XG4gICAqXG4gICAqICAxLiBUaGUgbG9va3VwIHJvbGUgbWF5IG5vdCBleGlzdCAoaXQgd2FzIGFkZGVkIGluIGJvb3RzdHJhcCBzdGFjayB2ZXJzaW9uIDcpLiBJZiBzbzpcbiAgICogICAgIGEuIFJldHVybiB0aGUgZGVmYXVsdCBjcmVkZW50aWFscyBpZiB0aGUgZGVmYXVsdCBjcmVkZW50aWFscyBhcmUgZm9yIHRoZSBzdGFjayBhY2NvdW50XG4gICAqICAgICAgICAoeW91IHdpbGwgbm90aWNlIHRoaXMgYXMgYGlzRmFsbGJhY2tDcmVkZW50aWFscz10cnVlYCkuXG4gICAqICAgICBiLiBUaHJvdyBhbiBlcnJvciBpZiB0aGUgZGVmYXVsdCBjcmVkZW50aWFscyBhcmUgbm90IGZvciB0aGUgc3RhY2sgYWNjb3VudC5cbiAgICpcbiAgICogIDIuIFRoZSBsb29rdXAgcm9sZSBtYXkgbm90IGhhdmUgdGhlIGNvcnJlY3QgcGVybWlzc2lvbnMgKGZvciBleGFtcGxlLCBSZWFkT25seUFjY2VzcyB3YXMgYWRkZWQgaW5cbiAgICogICAgIGJvb3RzdHJhcCBzdGFjayB2ZXJzaW9uIDgpOyB0aGUgc3RhY2sgd2lsbCBoYXZlIGEgbWluaW11bSB2ZXJzaW9uIG51bWJlciBvbiBpdC5cbiAgICogICAgIGEuIElmIGl0IGRvZXMgbm90IHdlIHRocm93IGFuIGVycm9yIHdoaWNoIHNob3VsZCBiZSBoYW5kbGVkIGluIHRoZSBjYWxsaW5nXG4gICAqICAgICAgICBmdW5jdGlvbiAoYW5kIGZhbGxiYWNrIHRvIHVzZSBhIGRpZmZlcmVudCByb2xlLCBldGMpXG4gICAqXG4gICAqIFVwb24gc3VjY2VzcywgY2FsbGVyIHdpbGwgaGF2ZSBhbiBTREsgZm9yIHRoZSByaWdodCBhY2NvdW50LCB3aGljaCBtYXkgb3IgbWF5IG5vdCBoYXZlXG4gICAqIHRoZSByaWdodCBwZXJtaXNzaW9ucy5cbiAgICovXG4gIHB1YmxpYyBhc3luYyBhY2Nlc3NTdGFja0Zvckxvb2t1cChzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KTogUHJvbWlzZTxUYXJnZXRFbnZpcm9ubWVudD4ge1xuICAgIGlmICghc3RhY2suZW52aXJvbm1lbnQpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYFRoZSBzdGFjayAke3N0YWNrLmRpc3BsYXlOYW1lfSBkb2VzIG5vdCBoYXZlIGFuIGVudmlyb25tZW50YCk7XG4gICAgfVxuXG4gICAgY29uc3QgbG9va3VwRW52ID0gYXdhaXQgdGhpcy5wcmVwYXJlU2RrKHtcbiAgICAgIGVudmlyb25tZW50OiBzdGFjay5lbnZpcm9ubWVudCxcbiAgICAgIG1vZGU6IE1vZGUuRm9yUmVhZGluZyxcbiAgICAgIGFzc3VtZVJvbGVBcm46IHN0YWNrLmxvb2t1cFJvbGU/LmFybixcbiAgICAgIGFzc3VtZVJvbGVFeHRlcm5hbElkOiBzdGFjay5sb29rdXBSb2xlPy5hc3N1bWVSb2xlRXh0ZXJuYWxJZCxcbiAgICAgIGFzc3VtZVJvbGVBZGRpdGlvbmFsT3B0aW9uczogc3RhY2subG9va3VwUm9sZT8uYXNzdW1lUm9sZUFkZGl0aW9uYWxPcHRpb25zLFxuICAgIH0pO1xuXG4gICAgLy8gaWYgd2Ugc3VjY2VlZCBpbiBhc3N1bWluZyB0aGUgbG9va3VwIHJvbGUsIG1ha2Ugc3VyZSB3ZSBoYXZlIHRoZSBjb3JyZWN0IGJvb3RzdHJhcCBzdGFjayB2ZXJzaW9uXG4gICAgaWYgKGxvb2t1cEVudi5kaWRBc3N1bWVSb2xlICYmIHN0YWNrLmxvb2t1cFJvbGU/LmJvb3RzdHJhcFN0YWNrVmVyc2lvblNzbVBhcmFtZXRlciAmJiBzdGFjay5sb29rdXBSb2xlLnJlcXVpcmVzQm9vdHN0cmFwU3RhY2tWZXJzaW9uKSB7XG4gICAgICBjb25zdCB2ZXJzaW9uID0gYXdhaXQgbG9va3VwRW52LnJlc291cmNlcy52ZXJzaW9uRnJvbVNzbVBhcmFtZXRlcihzdGFjay5sb29rdXBSb2xlLmJvb3RzdHJhcFN0YWNrVmVyc2lvblNzbVBhcmFtZXRlcik7XG4gICAgICBpZiAodmVyc2lvbiA8IHN0YWNrLmxvb2t1cFJvbGUucmVxdWlyZXNCb290c3RyYXBTdGFja1ZlcnNpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgQm9vdHN0cmFwIHN0YWNrIHZlcnNpb24gJyR7c3RhY2subG9va3VwUm9sZS5yZXF1aXJlc0Jvb3RzdHJhcFN0YWNrVmVyc2lvbn0nIGlzIHJlcXVpcmVkLCBmb3VuZCB2ZXJzaW9uICcke3ZlcnNpb259Jy4gVG8gZ2V0IHJpZCBvZiB0aGlzIGVycm9yLCBwbGVhc2UgdXBncmFkZSB0byBib290c3RyYXAgdmVyc2lvbiA+PSAke3N0YWNrLmxvb2t1cFJvbGUucmVxdWlyZXNCb290c3RyYXBTdGFja1ZlcnNpb259YCk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChsb29rdXBFbnYuaXNGYWxsYmFja0NyZWRlbnRpYWxzKSB7XG4gICAgICBjb25zdCBhcm4gPSBhd2FpdCBsb29rdXBFbnYucmVwbGFjZVBsYWNlaG9sZGVycyhzdGFjay5sb29rdXBSb2xlPy5hcm4pO1xuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX1dBUk4ubXNnKGBMb29rdXAgcm9sZSAke2Fybn0gd2FzIG5vdCBhc3N1bWVkLiBQcm9jZWVkaW5nIHdpdGggZGVmYXVsdCBjcmVkZW50aWFscy5gKSk7XG4gICAgfVxuICAgIHJldHVybiBsb29rdXBFbnY7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGFuIFNESyB0byBhY2Nlc3MgdGhlIGdpdmVuIHN0YWNrJ3MgZW52aXJvbm1lbnQgZm9yIHJlYWRpbmcgc3RhY2sgYXR0cmlidXRlc1xuICAgKlxuICAgKiBXaWxsIHVzZSBhIHBsdWdpbiBpZiBhdmFpbGFibGUsIHVzZSB0aGUgZGVmYXVsdCBBV1MgY3JlZGVudGlhbHMgaWYgbm90LlxuICAgKiBUaGUgYG1vZGVgIHBhcmFtZXRlciBpcyBvbmx5IHVzZWQgZm9yIHF1ZXJ5aW5nIHBsdWdpbnMuXG4gICAqXG4gICAqIFdpbGwgdHJ5IHRvIGFzc3VtZSB0aGUgbG9va3VwIHJvbGUgaWYgZ2l2ZW4sIHdpbGwgdXNlIHRoZSByZWd1bGFyIHN0YWNrIG9wZXJhdGlvbnNcbiAgICogYWNjZXNzIChkZXBsb3ktcm9sZSkgb3RoZXJ3aXNlLiBXaGVuIGNhbGxpbmcgdGhpcywgeW91IHNob3VsZCBhc3N1bWUgdGhhdCB5b3Ugd2lsbCBnZXRcbiAgICogdGhlIGxlYXN0IHByaXZpbGVnZWQgcm9sZSwgc28gZG9uJ3QgdHJ5IHRvIHVzZSBpdCBmb3IgYW55dGhpbmcgdGhlIGBkZXBsb3ktcm9sZWBcbiAgICogd291bGRuJ3QgYmUgYWJsZSB0byBkby4gQWxzbyB5b3UgY2Fubm90IHJlbHkgb24gYmVpbmcgYWJsZSB0byByZWFkIGVuY3J5cHRlZCBhbnl0aGluZy5cbiAgICovXG4gIHB1YmxpYyBhc3luYyBhY2Nlc3NTdGFja0Zvckxvb2t1cEJlc3RFZmZvcnQoc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCk6IFByb21pc2U8VGFyZ2V0RW52aXJvbm1lbnQ+IHtcbiAgICBpZiAoIXN0YWNrLmVudmlyb25tZW50KSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBUaGUgc3RhY2sgJHtzdGFjay5kaXNwbGF5TmFtZX0gZG9lcyBub3QgaGF2ZSBhbiBlbnZpcm9ubWVudGApO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hY2Nlc3NTdGFja0Zvckxvb2t1cChzdGFjayk7XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfV0FSTi5tc2coYCR7Zm9ybWF0RXJyb3JNZXNzYWdlKGUpfWApKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuYWNjZXNzU3RhY2tGb3JTdGFja09wZXJhdGlvbnMoc3RhY2ssIE1vZGUuRm9yUmVhZGluZyk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGFuIFNESyB0byBhY2Nlc3MgdGhlIGdpdmVuIHN0YWNrJ3MgZW52aXJvbm1lbnQgZm9yIHN0YWNrIG9wZXJhdGlvbnNcbiAgICpcbiAgICogV2lsbCB1c2UgYSBwbHVnaW4gaWYgYXZhaWxhYmxlLCB1c2UgdGhlIGRlZmF1bHQgQVdTIGNyZWRlbnRpYWxzIGlmIG5vdC5cbiAgICogVGhlIGBtb2RlYCBwYXJhbWV0ZXIgaXMgb25seSB1c2VkIGZvciBxdWVyeWluZyBwbHVnaW5zLlxuICAgKlxuICAgKiBXaWxsIGFzc3VtZSB0aGUgZGVwbG95IHJvbGUgaWYgY29uZmlndXJlZCBvbiB0aGUgc3RhY2suIENoZWNrIHRoZSBkZWZhdWx0IGBkZXBsb3ktcm9sZWBcbiAgICogcG9saWNpZXMgdG8gc2VlIHdoYXQgeW91IGNhbiBkbyB3aXRoIHRoaXMgcm9sZS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgYWNjZXNzU3RhY2tGb3JTdGFja09wZXJhdGlvbnMoc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCwgbW9kZTogTW9kZSk6IFByb21pc2U8VGFyZ2V0RW52aXJvbm1lbnQ+IHtcbiAgICBpZiAoIXN0YWNrLmVudmlyb25tZW50KSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBUaGUgc3RhY2sgJHtzdGFjay5kaXNwbGF5TmFtZX0gZG9lcyBub3QgaGF2ZSBhbiBlbnZpcm9ubWVudGApO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnByZXBhcmVTZGsoe1xuICAgICAgZW52aXJvbm1lbnQ6IHN0YWNrLmVudmlyb25tZW50LFxuICAgICAgbW9kZSxcbiAgICAgIGFzc3VtZVJvbGVBcm46IHN0YWNrLmFzc3VtZVJvbGVBcm4sXG4gICAgICBhc3N1bWVSb2xlRXh0ZXJuYWxJZDogc3RhY2suYXNzdW1lUm9sZUV4dGVybmFsSWQsXG4gICAgICBhc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnM6IHN0YWNrLmFzc3VtZVJvbGVBZGRpdGlvbmFsT3B0aW9ucyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVwYXJlIGFuIFNESyBmb3IgdXNlIGluIHRoZSBnaXZlbiBlbnZpcm9ubWVudCBhbmQgb3B0aW9uYWxseSB3aXRoIGEgcm9sZSBhc3N1bWVkLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwcmVwYXJlU2RrKFxuICAgIG9wdGlvbnM6IFByZXBhcmVTZGtSb2xlT3B0aW9ucyxcbiAgKTogUHJvbWlzZTxUYXJnZXRFbnZpcm9ubWVudD4ge1xuICAgIGNvbnN0IHJlc29sdmVkRW52aXJvbm1lbnQgPSBhd2FpdCB0aGlzLnNka1Byb3ZpZGVyLnJlc29sdmVFbnZpcm9ubWVudChvcHRpb25zLmVudmlyb25tZW50KTtcblxuICAgIC8vIFN1YnN0aXR1dGUgYW55IHBsYWNlaG9sZGVycyB3aXRoIGluZm9ybWF0aW9uIGFib3V0IHRoZSBjdXJyZW50IGVudmlyb25tZW50XG4gICAgY29uc3QgeyBhc3N1bWVSb2xlQXJuIH0gPSBhd2FpdCByZXBsYWNlRW52UGxhY2Vob2xkZXJzKHtcbiAgICAgIGFzc3VtZVJvbGVBcm46IG9wdGlvbnMuYXNzdW1lUm9sZUFybixcbiAgICB9LCByZXNvbHZlZEVudmlyb25tZW50LCB0aGlzLnNka1Byb3ZpZGVyKTtcblxuICAgIGNvbnN0IHN0YWNrU2RrID0gYXdhaXQgdGhpcy5jYWNoZWRTZGtGb3JFbnZpcm9ubWVudChyZXNvbHZlZEVudmlyb25tZW50LCBvcHRpb25zLm1vZGUsIHtcbiAgICAgIGFzc3VtZVJvbGVBcm4sXG4gICAgICBhc3N1bWVSb2xlRXh0ZXJuYWxJZDogb3B0aW9ucy5hc3N1bWVSb2xlRXh0ZXJuYWxJZCxcbiAgICAgIGFzc3VtZVJvbGVBZGRpdGlvbmFsT3B0aW9uczogb3B0aW9ucy5hc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnMsXG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc2RrOiBzdGFja1Nkay5zZGssXG4gICAgICByZXNvbHZlZEVudmlyb25tZW50LFxuICAgICAgcmVzb3VyY2VzOiB0aGlzLmVudmlyb25tZW50UmVzb3VyY2VzLmZvcihyZXNvbHZlZEVudmlyb25tZW50LCBzdGFja1Nkay5zZGssIHRoaXMuaW9IZWxwZXIpLFxuICAgICAgLy8gSWYgd2UgYXNrZWQgZm9yIGEgcm9sZSwgZGlkIG5vdCBzdWNjZXNzZnVsbHkgYXNzdW1lIGl0LCBhbmQgeWV0IGdvdCBoZXJlIHdpdGhvdXQgYW4gZXhjZXB0aW9uOiB0aGF0XG4gICAgICAvLyBtZWFucyB3ZSBtdXN0IGhhdmUgZmFsbGJhY2sgY3JlZGVudGlhbHMuXG4gICAgICBpc0ZhbGxiYWNrQ3JlZGVudGlhbHM6ICFzdGFja1Nkay5kaWRBc3N1bWVSb2xlICYmICEhYXNzdW1lUm9sZUFybixcbiAgICAgIGRpZEFzc3VtZVJvbGU6IHN0YWNrU2RrLmRpZEFzc3VtZVJvbGUsXG4gICAgICByZXBsYWNlUGxhY2Vob2xkZXJzOiBhc3luYyA8QSBleHRlbmRzIHN0cmluZyB8IHVuZGVmaW5lZD4oc3RyOiBBKSA9PiB7XG4gICAgICAgIGNvbnN0IHJldCA9IGF3YWl0IHJlcGxhY2VFbnZQbGFjZWhvbGRlcnMoeyBzdHIgfSwgcmVzb2x2ZWRFbnZpcm9ubWVudCwgdGhpcy5zZGtQcm92aWRlcik7XG4gICAgICAgIHJldHVybiByZXQuc3RyO1xuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjYWNoZWRTZGtGb3JFbnZpcm9ubWVudChcbiAgICBlbnZpcm9ubWVudDogY3hhcGkuRW52aXJvbm1lbnQsXG4gICAgbW9kZTogTW9kZSxcbiAgICBvcHRpb25zPzogQ3JlZGVudGlhbHNPcHRpb25zLFxuICApIHtcbiAgICBjb25zdCBjYWNoZUtleUVsZW1lbnRzID0gW1xuICAgICAgZW52aXJvbm1lbnQuYWNjb3VudCxcbiAgICAgIGVudmlyb25tZW50LnJlZ2lvbixcbiAgICAgIGAke21vZGV9YCxcbiAgICAgIG9wdGlvbnM/LmFzc3VtZVJvbGVBcm4gPz8gJycsXG4gICAgICBvcHRpb25zPy5hc3N1bWVSb2xlRXh0ZXJuYWxJZCA/PyAnJyxcbiAgICBdO1xuXG4gICAgaWYgKG9wdGlvbnM/LmFzc3VtZVJvbGVBZGRpdGlvbmFsT3B0aW9ucykge1xuICAgICAgY2FjaGVLZXlFbGVtZW50cy5wdXNoKEpTT04uc3RyaW5naWZ5KG9wdGlvbnMuYXNzdW1lUm9sZUFkZGl0aW9uYWxPcHRpb25zKSk7XG4gICAgfVxuXG4gICAgY29uc3QgY2FjaGVLZXkgPSBjYWNoZUtleUVsZW1lbnRzLmpvaW4oJzonKTtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuc2RrQ2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHJldHVybiBleGlzdGluZztcbiAgICB9XG4gICAgY29uc3QgcmV0ID0gYXdhaXQgdGhpcy5zZGtQcm92aWRlci5mb3JFbnZpcm9ubWVudChlbnZpcm9ubWVudCwgbW9kZSwgb3B0aW9ucyk7XG4gICAgdGhpcy5zZGtDYWNoZS5zZXQoY2FjaGVLZXksIHJldCk7XG4gICAgcmV0dXJuIHJldDtcbiAgfVxufVxuXG4vKipcbiAqIFNESyBvYnRhaW5lZCBieSBhc3N1bWluZyB0aGUgZGVwbG95IHJvbGVcbiAqIGZvciBhIGdpdmVuIGVudmlyb25tZW50XG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGFyZ2V0RW52aXJvbm1lbnQge1xuICAvKipcbiAgICogVGhlIFNESyBmb3IgdGhlIGdpdmVuIGVudmlyb25tZW50XG4gICAqL1xuICByZWFkb25seSBzZGs6IFNESztcblxuICAvKipcbiAgICogVGhlIHJlc29sdmVkIGVudmlyb25tZW50IGZvciB0aGUgc3RhY2tcbiAgICogKG5vIG1vcmUgJ3Vua25vd24tYWNjb3VudC91bmtub3duLXJlZ2lvbicpXG4gICAqL1xuICByZWFkb25seSByZXNvbHZlZEVudmlyb25tZW50OiBjeGFwaS5FbnZpcm9ubWVudDtcblxuICAvKipcbiAgICogQWNjZXNzIGNsYXNzIGZvciBlbnZpcm9ubWVudGFsIHJlc291cmNlcyB0byBoZWxwIHRoZSBkZXBsb3ltZW50XG4gICAqL1xuICByZWFkb25seSByZXNvdXJjZXM6IEVudmlyb25tZW50UmVzb3VyY2VzO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIG9yIG5vdCB3ZSBhc3N1bWVkIGEgcm9sZSBpbiB0aGUgcHJvY2VzcyBvZiBnZXR0aW5nIHRoZXNlIGNyZWRlbnRpYWxzXG4gICAqL1xuICByZWFkb25seSBkaWRBc3N1bWVSb2xlOiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIG9yIG5vdCB0aGVzZSBhcmUgZmFsbGJhY2sgY3JlZGVudGlhbHNcbiAgICpcbiAgICogRmFsbGJhY2sgY3JlZGVudGlhbHMgbWVhbnMgdGhhdCBhc3N1bWluZyB0aGUgaW50ZW5kZWQgcm9sZSBmYWlsZWQsIGJ1dCB0aGVcbiAgICogYmFzZSBjcmVkZW50aWFscyBoYXBwZW4gdG8gYmUgZm9yIHRoZSByaWdodCBhY2NvdW50IHNvIHdlIGp1c3QgcGlja2VkIHRob3NlXG4gICAqIGFuZCBob3BlIHRoZSBmdXR1cmUgU0RLIGNhbGxzIHN1Y2NlZWQuXG4gICAqXG4gICAqIFRoaXMgaXMgYSBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSBtZWNoYW5pc20gZnJvbSBhcm91bmQgdGhlIHRpbWUgd2UgaW50cm9kdWNlZFxuICAgKiBkZXBsb3ltZW50IHJvbGVzLlxuICAgKi9cbiAgcmVhZG9ubHkgaXNGYWxsYmFja0NyZWRlbnRpYWxzOiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBSZXBsYWNlIGVudmlyb25tZW50IHBsYWNlaG9sZGVycyBhY2NvcmRpbmcgdG8gdGhlIGN1cnJlbnQgZW52aXJvbm1lbnRcbiAgICovXG4gIHJlcGxhY2VQbGFjZWhvbGRlcnMoeDogc3RyaW5nIHwgdW5kZWZpbmVkKTogUHJvbWlzZTxTdHJpbmdXaXRob3V0UGxhY2Vob2xkZXJzIHwgdW5kZWZpbmVkPjtcbn1cblxuaW50ZXJmYWNlIFByZXBhcmVTZGtSb2xlT3B0aW9ucyB7XG4gIHJlYWRvbmx5IGVudmlyb25tZW50OiBjeGFwaS5FbnZpcm9ubWVudDtcbiAgcmVhZG9ubHkgbW9kZTogTW9kZTtcbiAgcmVhZG9ubHkgYXNzdW1lUm9sZUFybj86IHN0cmluZztcbiAgcmVhZG9ubHkgYXNzdW1lUm9sZUV4dGVybmFsSWQ/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGFzc3VtZVJvbGVBZGRpdGlvbmFsT3B0aW9ucz86IHsgW2tleTogc3RyaW5nXTogYW55IH07XG59XG4iXX0=