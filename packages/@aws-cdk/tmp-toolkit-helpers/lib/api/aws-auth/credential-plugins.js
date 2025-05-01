"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CredentialPlugins = void 0;
const util_1 = require("util");
const provider_caching_1 = require("./provider-caching");
const util_2 = require("../../util");
const private_1 = require("../io/private");
const toolkit_error_1 = require("../toolkit-error");
/**
 * Cache for credential providers.
 *
 * Given an account and an operating mode (read or write) will return an
 * appropriate credential provider for credentials for the given account. The
 * credential provider will be cached so that multiple AWS clients for the same
 * environment will not make multiple network calls to obtain credentials.
 *
 * Will use default credentials if they are for the right account; otherwise,
 * all loaded credential provider plugins will be tried to obtain credentials
 * for the given account.
 */
class CredentialPlugins {
    host;
    ioHelper;
    cache = {};
    constructor(host, ioHelper) {
        this.host = host;
        this.ioHelper = ioHelper;
    }
    async fetchCredentialsFor(awsAccountId, mode) {
        const key = `${awsAccountId}-${mode}`;
        if (!(key in this.cache)) {
            this.cache[key] = await this.lookupCredentials(awsAccountId, mode);
        }
        return this.cache[key];
    }
    get availablePluginNames() {
        return this.host.credentialProviderSources.map((s) => s.name);
    }
    async lookupCredentials(awsAccountId, mode) {
        const triedSources = [];
        // Otherwise, inspect the various credential sources we have
        for (const source of this.host.credentialProviderSources) {
            let available;
            try {
                available = await source.isAvailable();
            }
            catch (e) {
                // This shouldn't happen, but let's guard against it anyway
                await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_W0100.msg(`Uncaught exception in ${source.name}: ${(0, util_2.formatErrorMessage)(e)}`));
                available = false;
            }
            if (!available) {
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Credentials source ${source.name} is not available, ignoring it.`));
                continue;
            }
            triedSources.push(source);
            let canProvide;
            try {
                canProvide = await source.canProvideCredentials(awsAccountId);
            }
            catch (e) {
                // This shouldn't happen, but let's guard against it anyway
                await this.ioHelper.notify(private_1.IO.CDK_TOOLKIT_W0100.msg(`Uncaught exception in ${source.name}: ${(0, util_2.formatErrorMessage)(e)}`));
                canProvide = false;
            }
            if (!canProvide) {
                continue;
            }
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Using ${source.name} credentials for account ${awsAccountId}`));
            return {
                credentials: await v3ProviderFromPlugin(() => source.getProvider(awsAccountId, mode, {
                    supportsV3Providers: true,
                })),
                pluginName: source.name,
            };
        }
        return undefined;
    }
}
exports.CredentialPlugins = CredentialPlugins;
/**
 * Take a function that calls the plugin, and turn it into an SDKv3-compatible credential provider.
 *
 * What we will do is the following:
 *
 * - Query the plugin and see what kind of result it gives us.
 * - If the result is self-refreshing or doesn't need refreshing, we turn it into an SDKv3 provider
 *   and return it directly.
 *   * If the underlying return value is a provider, we will make it a caching provider
 *     (because we can't know if it will cache by itself or not).
 *   * If the underlying return value is a static credential, caching isn't relevant.
 *   * If the underlying return value is V2 credentials, those have caching built-in.
 * - If the result is a static credential that expires, we will wrap it in an SDKv3 provider
 *   that will query the plugin again when the credential expires.
 */
async function v3ProviderFromPlugin(producer) {
    const initial = await producer();
    if (isV3Provider(initial)) {
        // Already a provider, make caching
        return (0, provider_caching_1.makeCachingProvider)(initial);
    }
    else if (isV3Credentials(initial) && initial.expiration === undefined) {
        // Static credentials that don't need refreshing nor caching
        return () => Promise.resolve(initial);
    }
    else if (isV3Credentials(initial) && initial.expiration !== undefined) {
        // Static credentials that do need refreshing and caching
        return refreshFromPluginProvider(initial, producer);
    }
    else if (isV2Credentials(initial)) {
        // V2 credentials that refresh and cache themselves
        return v3ProviderFromV2Credentials(initial);
    }
    else {
        throw new toolkit_error_1.AuthenticationError(`Plugin returned a value that doesn't resemble AWS credentials: ${(0, util_1.inspect)(initial)}`);
    }
}
/**
 * Converts a V2 credential into a V3-compatible provider
 */
function v3ProviderFromV2Credentials(x) {
    return async () => {
        // Get will fetch or refresh as necessary
        await x.getPromise();
        return {
            accessKeyId: x.accessKeyId,
            secretAccessKey: x.secretAccessKey,
            sessionToken: x.sessionToken,
            expiration: x.expireTime ?? undefined,
        };
    };
}
function refreshFromPluginProvider(current, producer) {
    return async () => {
        if ((0, provider_caching_1.credentialsAboutToExpire)(current)) {
            const newCreds = await producer();
            if (!isV3Credentials(newCreds)) {
                throw new toolkit_error_1.AuthenticationError(`Plugin initially returned static V3 credentials but now returned something else: ${(0, util_1.inspect)(newCreds)}`);
            }
            current = newCreds;
        }
        return current;
    };
}
function isV3Provider(x) {
    return typeof x === 'function';
}
function isV2Credentials(x) {
    return !!(x && typeof x === 'object' && x.getPromise);
}
function isV3Credentials(x) {
    return !!(x && typeof x === 'object' && x.accessKeyId && !isV2Credentials(x));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JlZGVudGlhbC1wbHVnaW5zLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9hd3MtYXV0aC9jcmVkZW50aWFsLXBsdWdpbnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsK0JBQStCO0FBRy9CLHlEQUFtRjtBQUNuRixxQ0FBZ0Q7QUFDaEQsMkNBQWtEO0FBR2xELG9EQUF1RDtBQUV2RDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQWEsaUJBQWlCO0lBR0M7SUFBbUM7SUFGL0MsS0FBSyxHQUFnRSxFQUFFLENBQUM7SUFFekYsWUFBNkIsSUFBZ0IsRUFBbUIsUUFBa0I7UUFBckQsU0FBSSxHQUFKLElBQUksQ0FBWTtRQUFtQixhQUFRLEdBQVIsUUFBUSxDQUFVO0lBQ2xGLENBQUM7SUFFTSxLQUFLLENBQUMsbUJBQW1CLENBQUMsWUFBb0IsRUFBRSxJQUFVO1FBQy9ELE1BQU0sR0FBRyxHQUFHLEdBQUcsWUFBWSxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3RDLElBQUksQ0FBQyxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNyRSxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFFRCxJQUFXLG9CQUFvQjtRQUM3QixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDaEUsQ0FBQztJQUVPLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxZQUFvQixFQUFFLElBQVU7UUFDOUQsTUFBTSxZQUFZLEdBQStCLEVBQUUsQ0FB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QUFDO0lBQ2pCLENBQUMsQ0FBQztBQUNKLENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxDQUF1QjtJQUMzQyxPQUFPLE9BQU8sQ0FBQyxLQUFLLFVBQVUsQ0FBQztBQUNqQyxDQUFDO0FBRUQsU0FBUyxlQUFlLENBQUMsQ0FBdUI7SUFDOUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLEtBQUssUUFBUSxJQUFLLENBQWdDLENBQUMsVUFBVSxDQUFDLENBQUM7QUFDeEYsQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLENBQXVCO0lBQzlDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxLQUFLLFFBQVEsSUFBSSxDQUFDLENBQUMsV0FBVyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEYsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGluc3BlY3QgfSBmcm9tICd1dGlsJztcbmltcG9ydCB0eXBlIHsgQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlLCBGb3JSZWFkaW5nLCBGb3JXcml0aW5nLCBQbHVnaW5Qcm92aWRlclJlc3VsdCwgU0RLdjJDb21wYXRpYmxlQ3JlZGVudGlhbHMsIFNES3YzQ29tcGF0aWJsZUNyZWRlbnRpYWxQcm92aWRlciwgU0RLdjNDb21wYXRpYmxlQ3JlZGVudGlhbHMgfSBmcm9tICdAYXdzLWNkay9jbGktcGx1Z2luLWNvbnRyYWN0JztcbmltcG9ydCB0eXBlIHsgQXdzQ3JlZGVudGlhbElkZW50aXR5LCBBd3NDcmVkZW50aWFsSWRlbnRpdHlQcm92aWRlciB9IGZyb20gJ0BzbWl0aHkvdHlwZXMnO1xuaW1wb3J0IHsgY3JlZGVudGlhbHNBYm91dFRvRXhwaXJlLCBtYWtlQ2FjaGluZ1Byb3ZpZGVyIH0gZnJvbSAnLi9wcm92aWRlci1jYWNoaW5nJztcbmltcG9ydCB7IGZvcm1hdEVycm9yTWVzc2FnZSB9IGZyb20gJy4uLy4uL3V0aWwnO1xuaW1wb3J0IHsgSU8sIHR5cGUgSW9IZWxwZXIgfSBmcm9tICcuLi9pby9wcml2YXRlJztcbmltcG9ydCB0eXBlIHsgUGx1Z2luSG9zdCB9IGZyb20gJy4uL3BsdWdpbic7XG5pbXBvcnQgdHlwZSB7IE1vZGUgfSBmcm9tICcuLi9wbHVnaW4vbW9kZSc7XG5pbXBvcnQgeyBBdXRoZW50aWNhdGlvbkVycm9yIH0gZnJvbSAnLi4vdG9vbGtpdC1lcnJvcic7XG5cbi8qKlxuICogQ2FjaGUgZm9yIGNyZWRlbnRpYWwgcHJvdmlkZXJzLlxuICpcbiAqIEdpdmVuIGFuIGFjY291bnQgYW5kIGFuIG9wZXJhdGluZyBtb2RlIChyZWFkIG9yIHdyaXRlKSB3aWxsIHJldHVybiBhblxuICogYXBwcm9wcmlhdGUgY3JlZGVudGlhbCBwcm92aWRlciBmb3IgY3JlZGVudGlhbHMgZm9yIHRoZSBnaXZlbiBhY2NvdW50LiBUaGVcbiAqIGNyZWRlbnRpYWwgcHJvdmlkZXIgd2lsbCBiZSBjYWNoZWQgc28gdGhhdCBtdWx0aXBsZSBBV1MgY2xpZW50cyBmb3IgdGhlIHNhbWVcbiAqIGVudmlyb25tZW50IHdpbGwgbm90IG1ha2UgbXVsdGlwbGUgbmV0d29yayBjYWxscyB0byBvYnRhaW4gY3JlZGVudGlhbHMuXG4gKlxuICogV2lsbCB1c2UgZGVmYXVsdCBjcmVkZW50aWFscyBpZiB0aGV5IGFyZSBmb3IgdGhlIHJpZ2h0IGFjY291bnQ7IG90aGVyd2lzZSxcbiAqIGFsbCBsb2FkZWQgY3JlZGVudGlhbCBwcm92aWRlciBwbHVnaW5zIHdpbGwgYmUgdHJpZWQgdG8gb2J0YWluIGNyZWRlbnRpYWxzXG4gKiBmb3IgdGhlIGdpdmVuIGFjY291bnQuXG4gKi9cbmV4cG9ydCBjbGFzcyBDcmVkZW50aWFsUGx1Z2lucyB7XG4gIHByaXZhdGUgcmVhZG9ubHkgY2FjaGU6IHsgW2tleTogc3RyaW5nXTogUGx1Z2luQ3JlZGVudGlhbHNGZXRjaFJlc3VsdCB8IHVuZGVmaW5lZCB9ID0ge307XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBob3N0OiBQbHVnaW5Ib3N0LCBwcml2YXRlIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcikge1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGZldGNoQ3JlZGVudGlhbHNGb3IoYXdzQWNjb3VudElkOiBzdHJpbmcsIG1vZGU6IE1vZGUpOiBQcm9taXNlPFBsdWdpbkNyZWRlbnRpYWxzRmV0Y2hSZXN1bHQgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBrZXkgPSBgJHthd3NBY2NvdW50SWR9LSR7bW9kZX1gO1xuICAgIGlmICghKGtleSBpbiB0aGlzLmNhY2hlKSkge1xuICAgICAgdGhpcy5jYWNoZVtrZXldID0gYXdhaXQgdGhpcy5sb29rdXBDcmVkZW50aWFscyhhd3NBY2NvdW50SWQsIG1vZGUpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5jYWNoZVtrZXldO1xuICB9XG5cbiAgcHVibGljIGdldCBhdmFpbGFibGVQbHVnaW5OYW1lcygpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIHRoaXMuaG9zdC5jcmVkZW50aWFsUHJvdmlkZXJTb3VyY2VzLm1hcCgocykgPT4gcy5uYW1lKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9va3VwQ3JlZGVudGlhbHMoYXdzQWNjb3VudElkOiBzdHJpbmcsIG1vZGU6IE1vZGUpOiBQcm9taXNlPFBsdWdpbkNyZWRlbnRpYWxzRmV0Y2hSZXN1bHQgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCB0cmllZFNvdXJjZXM6IENyZWRlbnRpYWxQcm92aWRlclNvdXJjZVtdID0gW107XG4gICAgLy8gT3RoZXJ3aXNlLCBpbnNwZWN0IHRoZSB2YXJpb3VzIGNyZWRlbnRpYWwgc291cmNlcyB3ZSBoYXZlXG4gICAgZm9yIChjb25zdCBzb3VyY2Ugb2YgdGhpcy5ob3N0LmNyZWRlbnRpYWxQcm92aWRlclNvdXJjZXMpIHtcbiAgICAgIGxldCBhdmFpbGFibGU6IGJvb2xlYW47XG4gICAgICB0cnkge1xuICAgICAgICBhdmFpbGFibGUgPSBhd2FpdCBzb3VyY2UuaXNBdmFpbGFibGUoKTtcbiAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAvLyBUaGlzIHNob3VsZG4ndCBoYXBwZW4sIGJ1dCBsZXQncyBndWFyZCBhZ2FpbnN0IGl0IGFueXdheVxuICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5DREtfVE9PTEtJVF9XMDEwMC5tc2coYFVuY2F1Z2h0IGV4Y2VwdGlvbiBpbiAke3NvdXJjZS5uYW1lfTogJHtmb3JtYXRFcnJvck1lc3NhZ2UoZSl9YCkpO1xuICAgICAgICBhdmFpbGFibGUgPSBmYWxzZTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFhdmFpbGFibGUpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgQ3JlZGVudGlhbHMgc291cmNlICR7c291cmNlLm5hbWV9IGlzIG5vdCBhdmFpbGFibGUsIGlnbm9yaW5nIGl0LmApKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICB0cmllZFNvdXJjZXMucHVzaChzb3VyY2UpO1xuICAgICAgbGV0IGNhblByb3ZpZGU6IGJvb2xlYW47XG4gICAgICB0cnkge1xuICAgICAgICBjYW5Qcm92aWRlID0gYXdhaXQgc291cmNlLmNhblByb3ZpZGVDcmVkZW50aWFscyhhd3NBY2NvdW50SWQpO1xuICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgIC8vIFRoaXMgc2hvdWxkbid0IGhhcHBlbiwgYnV0IGxldCdzIGd1YXJkIGFnYWluc3QgaXQgYW55d2F5XG4gICAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkNES19UT09MS0lUX1cwMTAwLm1zZyhgVW5jYXVnaHQgZXhjZXB0aW9uIGluICR7c291cmNlLm5hbWV9OiAke2Zvcm1hdEVycm9yTWVzc2FnZShlKX1gKSk7XG4gICAgICAgIGNhblByb3ZpZGUgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmICghY2FuUHJvdmlkZSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYFVzaW5nICR7c291cmNlLm5hbWV9IGNyZWRlbnRpYWxzIGZvciBhY2NvdW50ICR7YXdzQWNjb3VudElkfWApKTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY3JlZGVudGlhbHM6IGF3YWl0IHYzUHJvdmlkZXJGcm9tUGx1Z2luKCgpID0+IHNvdXJjZS5nZXRQcm92aWRlcihhd3NBY2NvdW50SWQsIG1vZGUgYXMgRm9yUmVhZGluZyB8IEZvcldyaXRpbmcsIHtcbiAgICAgICAgICBzdXBwb3J0c1YzUHJvdmlkZXJzOiB0cnVlLFxuICAgICAgICB9KSksXG4gICAgICAgIHBsdWdpbk5hbWU6IHNvdXJjZS5uYW1lLFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxufVxuXG4vKipcbiAqIFJlc3VsdCBmcm9tIHRyeWluZyB0byBmZXRjaCBjcmVkZW50aWFscyBmcm9tIHRoZSBQbHVnaW4gaG9zdFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbkNyZWRlbnRpYWxzRmV0Y2hSZXN1bHQge1xuICAvKipcbiAgICogU0RLLXYzIGNvbXBhdGlibGUgY3JlZGVudGlhbCBwcm92aWRlclxuICAgKi9cbiAgcmVhZG9ubHkgY3JlZGVudGlhbHM6IEF3c0NyZWRlbnRpYWxJZGVudGl0eVByb3ZpZGVyO1xuXG4gIC8qKlxuICAgKiBOYW1lIG9mIHBsdWdpbiB0aGF0IHN1Y2Nlc3NmdWxseSBwcm92aWRlZCBjcmVkZW50aWFsc1xuICAgKi9cbiAgcmVhZG9ubHkgcGx1Z2luTmFtZTogc3RyaW5nO1xufVxuXG4vKipcbiAqIFRha2UgYSBmdW5jdGlvbiB0aGF0IGNhbGxzIHRoZSBwbHVnaW4sIGFuZCB0dXJuIGl0IGludG8gYW4gU0RLdjMtY29tcGF0aWJsZSBjcmVkZW50aWFsIHByb3ZpZGVyLlxuICpcbiAqIFdoYXQgd2Ugd2lsbCBkbyBpcyB0aGUgZm9sbG93aW5nOlxuICpcbiAqIC0gUXVlcnkgdGhlIHBsdWdpbiBhbmQgc2VlIHdoYXQga2luZCBvZiByZXN1bHQgaXQgZ2l2ZXMgdXMuXG4gKiAtIElmIHRoZSByZXN1bHQgaXMgc2VsZi1yZWZyZXNoaW5nIG9yIGRvZXNuJ3QgbmVlZCByZWZyZXNoaW5nLCB3ZSB0dXJuIGl0IGludG8gYW4gU0RLdjMgcHJvdmlkZXJcbiAqICAgYW5kIHJldHVybiBpdCBkaXJlY3RseS5cbiAqICAgKiBJZiB0aGUgdW5kZXJseWluZyByZXR1cm4gdmFsdWUgaXMgYSBwcm92aWRlciwgd2Ugd2lsbCBtYWtlIGl0IGEgY2FjaGluZyBwcm92aWRlclxuICogICAgIChiZWNhdXNlIHdlIGNhbid0IGtub3cgaWYgaXQgd2lsbCBjYWNoZSBieSBpdHNlbGYgb3Igbm90KS5cbiAqICAgKiBJZiB0aGUgdW5kZXJseWluZyByZXR1cm4gdmFsdWUgaXMgYSBzdGF0aWMgY3JlZGVudGlhbCwgY2FjaGluZyBpc24ndCByZWxldmFudC5cbiAqICAgKiBJZiB0aGUgdW5kZXJseWluZyByZXR1cm4gdmFsdWUgaXMgVjIgY3JlZGVudGlhbHMsIHRob3NlIGhhdmUgY2FjaGluZyBidWlsdC1pbi5cbiAqIC0gSWYgdGhlIHJlc3VsdCBpcyBhIHN0YXRpYyBjcmVkZW50aWFsIHRoYXQgZXhwaXJlcywgd2Ugd2lsbCB3cmFwIGl0IGluIGFuIFNES3YzIHByb3ZpZGVyXG4gKiAgIHRoYXQgd2lsbCBxdWVyeSB0aGUgcGx1Z2luIGFnYWluIHdoZW4gdGhlIGNyZWRlbnRpYWwgZXhwaXJlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gdjNQcm92aWRlckZyb21QbHVnaW4ocHJvZHVjZXI6ICgpID0+IFByb21pc2U8UGx1Z2luUHJvdmlkZXJSZXN1bHQ+KTogUHJvbWlzZTxBd3NDcmVkZW50aWFsSWRlbnRpdHlQcm92aWRlcj4ge1xuICBjb25zdCBpbml0aWFsID0gYXdhaXQgcHJvZHVjZXIoKTtcblxuICBpZiAoaXNWM1Byb3ZpZGVyKGluaXRpYWwpKSB7XG4gICAgLy8gQWxyZWFkeSBhIHByb3ZpZGVyLCBtYWtlIGNhY2hpbmdcbiAgICByZXR1cm4gbWFrZUNhY2hpbmdQcm92aWRlcihpbml0aWFsKTtcbiAgfSBlbHNlIGlmIChpc1YzQ3JlZGVudGlhbHMoaW5pdGlhbCkgJiYgaW5pdGlhbC5leHBpcmF0aW9uID09PSB1bmRlZmluZWQpIHtcbiAgICAvLyBTdGF0aWMgY3JlZGVudGlhbHMgdGhhdCBkb24ndCBuZWVkIHJlZnJlc2hpbmcgbm9yIGNhY2hpbmdcbiAgICByZXR1cm4gKCkgPT4gUHJvbWlzZS5yZXNvbHZlKGluaXRpYWwpO1xuICB9IGVsc2UgaWYgKGlzVjNDcmVkZW50aWFscyhpbml0aWFsKSAmJiBpbml0aWFsLmV4cGlyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgIC8vIFN0YXRpYyBjcmVkZW50aWFscyB0aGF0IGRvIG5lZWQgcmVmcmVzaGluZyBhbmQgY2FjaGluZ1xuICAgIHJldHVybiByZWZyZXNoRnJvbVBsdWdpblByb3ZpZGVyKGluaXRpYWwsIHByb2R1Y2VyKTtcbiAgfSBlbHNlIGlmIChpc1YyQ3JlZGVudGlhbHMoaW5pdGlhbCkpIHtcbiAgICAvLyBWMiBjcmVkZW50aWFscyB0aGF0IHJlZnJlc2ggYW5kIGNhY2hlIHRoZW1zZWx2ZXNcbiAgICByZXR1cm4gdjNQcm92aWRlckZyb21WMkNyZWRlbnRpYWxzKGluaXRpYWwpO1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBBdXRoZW50aWNhdGlvbkVycm9yKGBQbHVnaW4gcmV0dXJuZWQgYSB2YWx1ZSB0aGF0IGRvZXNuJ3QgcmVzZW1ibGUgQVdTIGNyZWRlbnRpYWxzOiAke2luc3BlY3QoaW5pdGlhbCl9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhIFYyIGNyZWRlbnRpYWwgaW50byBhIFYzLWNvbXBhdGlibGUgcHJvdmlkZXJcbiAqL1xuZnVuY3Rpb24gdjNQcm92aWRlckZyb21WMkNyZWRlbnRpYWxzKHg6IFNES3YyQ29tcGF0aWJsZUNyZWRlbnRpYWxzKTogQXdzQ3JlZGVudGlhbElkZW50aXR5UHJvdmlkZXIge1xuICByZXR1cm4gYXN5bmMgKCkgPT4ge1xuICAgIC8vIEdldCB3aWxsIGZldGNoIG9yIHJlZnJlc2ggYXMgbmVjZXNzYXJ5XG4gICAgYXdhaXQgeC5nZXRQcm9taXNlKCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWNjZXNzS2V5SWQ6IHguYWNjZXNzS2V5SWQsXG4gICAgICBzZWNyZXRBY2Nlc3NLZXk6IHguc2VjcmV0QWNjZXNzS2V5LFxuICAgICAgc2Vzc2lvblRva2VuOiB4LnNlc3Npb25Ub2tlbixcbiAgICAgIGV4cGlyYXRpb246IHguZXhwaXJlVGltZSA/PyB1bmRlZmluZWQsXG4gICAgfTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVmcmVzaEZyb21QbHVnaW5Qcm92aWRlcihjdXJyZW50OiBBd3NDcmVkZW50aWFsSWRlbnRpdHksIHByb2R1Y2VyOiAoKSA9PiBQcm9taXNlPFBsdWdpblByb3ZpZGVyUmVzdWx0Pik6IEF3c0NyZWRlbnRpYWxJZGVudGl0eVByb3ZpZGVyIHtcbiAgcmV0dXJuIGFzeW5jICgpID0+IHtcbiAgICBpZiAoY3JlZGVudGlhbHNBYm91dFRvRXhwaXJlKGN1cnJlbnQpKSB7XG4gICAgICBjb25zdCBuZXdDcmVkcyA9IGF3YWl0IHByb2R1Y2VyKCk7XG4gICAgICBpZiAoIWlzVjNDcmVkZW50aWFscyhuZXdDcmVkcykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEF1dGhlbnRpY2F0aW9uRXJyb3IoYFBsdWdpbiBpbml0aWFsbHkgcmV0dXJuZWQgc3RhdGljIFYzIGNyZWRlbnRpYWxzIGJ1dCBub3cgcmV0dXJuZWQgc29tZXRoaW5nIGVsc2U6ICR7aW5zcGVjdChuZXdDcmVkcyl9YCk7XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gbmV3Q3JlZHM7XG4gICAgfVxuICAgIHJldHVybiBjdXJyZW50O1xuICB9O1xufVxuXG5mdW5jdGlvbiBpc1YzUHJvdmlkZXIoeDogUGx1Z2luUHJvdmlkZXJSZXN1bHQpOiB4IGlzIFNES3YzQ29tcGF0aWJsZUNyZWRlbnRpYWxQcm92aWRlciB7XG4gIHJldHVybiB0eXBlb2YgeCA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gaXNWMkNyZWRlbnRpYWxzKHg6IFBsdWdpblByb3ZpZGVyUmVzdWx0KTogeCBpcyBTREt2MkNvbXBhdGlibGVDcmVkZW50aWFscyB7XG4gIHJldHVybiAhISh4ICYmIHR5cGVvZiB4ID09PSAnb2JqZWN0JyAmJiAoeCBhcyBTREt2MkNvbXBhdGlibGVDcmVkZW50aWFscykuZ2V0UHJvbWlzZSk7XG59XG5cbmZ1bmN0aW9uIGlzVjNDcmVkZW50aWFscyh4OiBQbHVnaW5Qcm92aWRlclJlc3VsdCk6IHggaXMgU0RLdjNDb21wYXRpYmxlQ3JlZGVudGlhbHMge1xuICByZXR1cm4gISEoeCAmJiB0eXBlb2YgeCA9PT0gJ29iamVjdCcgJiYgeC5hY2Nlc3NLZXlJZCAmJiAhaXNWMkNyZWRlbnRpYWxzKHgpKTtcbn1cbiJdfQ==