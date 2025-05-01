"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyAgentProvider = void 0;
const fs = require("fs-extra");
const proxy_agent_1 = require("proxy-agent");
const private_1 = require("../io/private");
class ProxyAgentProvider {
    ioHelper;
    constructor(ioHelper) {
        this.ioHelper = ioHelper;
    }
    async create(options) {
        // Force it to use the proxy provided through the command line.
        // Otherwise, let the ProxyAgent auto-detect the proxy using environment variables.
        const getProxyForUrl = options.proxyAddress != null
            ? () => Promise.resolve(options.proxyAddress)
            : undefined;
        return new proxy_agent_1.ProxyAgent({
            ca: await this.tryGetCACert(options.caBundlePath),
            getProxyForUrl,
        });
    }
    async tryGetCACert(bundlePath) {
        const path = bundlePath || this.caBundlePathFromEnvironment();
        if (path) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg(`Using CA bundle path: ${path}`));
            try {
                if (!fs.pathExistsSync(path)) {
                    return undefined;
                }
                return fs.readFileSync(path, { encoding: 'utf-8' });
            }
            catch (e) {
                await this.ioHelper.notify(private_1.IO.DEFAULT_SDK_DEBUG.msg(String(e)));
                return undefined;
            }
        }
        return undefined;
    }
    /**
     * Find and return a CA certificate bundle path to be passed into the SDK.
     */
    caBundlePathFromEnvironment() {
        if (process.env.aws_ca_bundle) {
            return process.env.aws_ca_bundle;
        }
        if (process.env.AWS_CA_BUNDLE) {
            return process.env.AWS_CA_BUNDLE;
        }
        return undefined;
    }
}
exports.ProxyAgentProvider = ProxyAgentProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJveHktYWdlbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2F3cy1hdXRoL3Byb3h5LWFnZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLCtCQUErQjtBQUMvQiw2Q0FBeUM7QUFFekMsMkNBQWtEO0FBRWxELE1BQWEsa0JBQWtCO0lBQ1osUUFBUSxDQUFXO0lBRXBDLFlBQW1CLFFBQWtCO1FBQ25DLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO0lBQzNCLENBQUM7SUFFTSxLQUFLLENBQUMsTUFBTSxDQUFDLE9BQXVCO1FBQ3pDLCtEQUErRDtRQUMvRCxtRkFBbUY7UUFDbkYsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLFlBQVksSUFBSSxJQUFJO1lBQ2pELENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFhLENBQUM7WUFDOUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUVkLE9BQU8sSUFBSSx3QkFBVSxDQUFDO1lBQ3BCLEVBQUUsRUFBRSxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQztZQUNqRCxjQUFjO1NBQ2YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLEtBQUssQ0FBQyxZQUFZLENBQUMsVUFBbUI7UUFDNUMsTUFBTSxJQUFJLEdBQUcsVUFBVSxJQUFJLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFDO1FBQzlELElBQUksSUFBSSxFQUFFLENBQUM7WUFDVCxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMseUJBQXlCLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztZQUN0RixJQUFJLENBQUM7Z0JBQ0gsSUFBSSxDQUFDLEVBQUUsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztvQkFDN0IsT0FBTyxTQUFTLENBQUM7Z0JBQ25CLENBQUM7Z0JBQ0QsT0FBTyxFQUFFLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDO1lBQ3RELENBQUM7WUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO2dCQUNoQixNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDaEUsT0FBTyxTQUFTLENBQUM7WUFDbkIsQ0FBQztRQUNILENBQUM7UUFDRCxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRUQ7O09BRUc7SUFDSywyQkFBMkI7UUFDakMsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQzlCLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7UUFDbkMsQ0FBQztRQUNELElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUM5QixPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO1FBQ25DLENBQUM7UUFDRCxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0NBQ0Y7QUFqREQsZ0RBaURDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0IHsgUHJveHlBZ2VudCB9IGZyb20gJ3Byb3h5LWFnZW50JztcbmltcG9ydCB0eXBlIHsgU2RrSHR0cE9wdGlvbnMgfSBmcm9tICcuL3Nkay1wcm92aWRlcic7XG5pbXBvcnQgeyBJTywgdHlwZSBJb0hlbHBlciB9IGZyb20gJy4uL2lvL3ByaXZhdGUnO1xuXG5leHBvcnQgY2xhc3MgUHJveHlBZ2VudFByb3ZpZGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBpb0hlbHBlcjogSW9IZWxwZXI7XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKGlvSGVscGVyOiBJb0hlbHBlcikge1xuICAgIHRoaXMuaW9IZWxwZXIgPSBpb0hlbHBlcjtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBjcmVhdGUob3B0aW9uczogU2RrSHR0cE9wdGlvbnMpIHtcbiAgICAvLyBGb3JjZSBpdCB0byB1c2UgdGhlIHByb3h5IHByb3ZpZGVkIHRocm91Z2ggdGhlIGNvbW1hbmQgbGluZS5cbiAgICAvLyBPdGhlcndpc2UsIGxldCB0aGUgUHJveHlBZ2VudCBhdXRvLWRldGVjdCB0aGUgcHJveHkgdXNpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzLlxuICAgIGNvbnN0IGdldFByb3h5Rm9yVXJsID0gb3B0aW9ucy5wcm94eUFkZHJlc3MgIT0gbnVsbFxuICAgICAgPyAoKSA9PiBQcm9taXNlLnJlc29sdmUob3B0aW9ucy5wcm94eUFkZHJlc3MhKVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gbmV3IFByb3h5QWdlbnQoe1xuICAgICAgY2E6IGF3YWl0IHRoaXMudHJ5R2V0Q0FDZXJ0KG9wdGlvbnMuY2FCdW5kbGVQYXRoKSxcbiAgICAgIGdldFByb3h5Rm9yVXJsLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB0cnlHZXRDQUNlcnQoYnVuZGxlUGF0aD86IHN0cmluZykge1xuICAgIGNvbnN0IHBhdGggPSBidW5kbGVQYXRoIHx8IHRoaXMuY2FCdW5kbGVQYXRoRnJvbUVudmlyb25tZW50KCk7XG4gICAgaWYgKHBhdGgpIHtcbiAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfU0RLX0RFQlVHLm1zZyhgVXNpbmcgQ0EgYnVuZGxlIHBhdGg6ICR7cGF0aH1gKSk7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIWZzLnBhdGhFeGlzdHNTeW5jKHBhdGgpKSB7XG4gICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZnMucmVhZEZpbGVTeW5jKHBhdGgsIHsgZW5jb2Rpbmc6ICd1dGYtOCcgfSk7XG4gICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9TREtfREVCVUcubXNnKFN0cmluZyhlKSkpO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbmQgYW5kIHJldHVybiBhIENBIGNlcnRpZmljYXRlIGJ1bmRsZSBwYXRoIHRvIGJlIHBhc3NlZCBpbnRvIHRoZSBTREsuXG4gICAqL1xuICBwcml2YXRlIGNhQnVuZGxlUGF0aEZyb21FbnZpcm9ubWVudCgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGlmIChwcm9jZXNzLmVudi5hd3NfY2FfYnVuZGxlKSB7XG4gICAgICByZXR1cm4gcHJvY2Vzcy5lbnYuYXdzX2NhX2J1bmRsZTtcbiAgICB9XG4gICAgaWYgKHByb2Nlc3MuZW52LkFXU19DQV9CVU5ETEUpIHtcbiAgICAgIHJldHVybiBwcm9jZXNzLmVudi5BV1NfQ0FfQlVORExFO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbiJdfQ==