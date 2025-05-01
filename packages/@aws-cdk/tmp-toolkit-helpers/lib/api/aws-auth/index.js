"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultCliUserAgent = exports.credentialsAboutToExpire = exports.CredentialPlugins = exports.setSdkTracing = exports.AwsCliCompatible = exports.cached = exports.AccountAccessKeyCache = void 0;
__exportStar(require("./proxy-agent"), exports);
__exportStar(require("./sdk"), exports);
__exportStar(require("./sdk-provider"), exports);
__exportStar(require("./sdk-logger"), exports);
// temporary testing exports
var account_cache_1 = require("./account-cache");
Object.defineProperty(exports, "AccountAccessKeyCache", { enumerable: true, get: function () { return account_cache_1.AccountAccessKeyCache; } });
var cached_1 = require("./cached");
Object.defineProperty(exports, "cached", { enumerable: true, get: function () { return cached_1.cached; } });
var awscli_compatible_1 = require("./awscli-compatible");
Object.defineProperty(exports, "AwsCliCompatible", { enumerable: true, get: function () { return awscli_compatible_1.AwsCliCompatible; } });
var tracing_1 = require("./tracing");
Object.defineProperty(exports, "setSdkTracing", { enumerable: true, get: function () { return tracing_1.setSdkTracing; } });
var credential_plugins_1 = require("./credential-plugins");
Object.defineProperty(exports, "CredentialPlugins", { enumerable: true, get: function () { return credential_plugins_1.CredentialPlugins; } });
var provider_caching_1 = require("./provider-caching");
Object.defineProperty(exports, "credentialsAboutToExpire", { enumerable: true, get: function () { return provider_caching_1.credentialsAboutToExpire; } });
var user_agent_1 = require("./user-agent");
Object.defineProperty(exports, "defaultCliUserAgent", { enumerable: true, get: function () { return user_agent_1.defaultCliUserAgent; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2F3cy1hdXRoL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsZ0RBQThCO0FBQzlCLHdDQUFzQjtBQUN0QixpREFBK0I7QUFDL0IsK0NBQTZCO0FBRTdCLDRCQUE0QjtBQUM1QixpREFBd0Q7QUFBL0Msc0hBQUEscUJBQXFCLE9BQUE7QUFDOUIsbUNBQWtDO0FBQXpCLGdHQUFBLE1BQU0sT0FBQTtBQUNmLHlEQUF1RDtBQUE5QyxxSEFBQSxnQkFBZ0IsT0FBQTtBQUN6QixxQ0FBMEM7QUFBakMsd0dBQUEsYUFBYSxPQUFBO0FBQ3RCLDJEQUF5RDtBQUFoRCx1SEFBQSxpQkFBaUIsT0FBQTtBQUMxQix1REFBOEQ7QUFBckQsNEhBQUEsd0JBQXdCLE9BQUE7QUFDakMsMkNBQW1EO0FBQTFDLGlIQUFBLG1CQUFtQixPQUFBIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0ICogZnJvbSAnLi9wcm94eS1hZ2VudCc7XG5leHBvcnQgKiBmcm9tICcuL3Nkayc7XG5leHBvcnQgKiBmcm9tICcuL3Nkay1wcm92aWRlcic7XG5leHBvcnQgKiBmcm9tICcuL3Nkay1sb2dnZXInO1xuXG4vLyB0ZW1wb3JhcnkgdGVzdGluZyBleHBvcnRzXG5leHBvcnQgeyBBY2NvdW50QWNjZXNzS2V5Q2FjaGUgfSBmcm9tICcuL2FjY291bnQtY2FjaGUnO1xuZXhwb3J0IHsgY2FjaGVkIH0gZnJvbSAnLi9jYWNoZWQnO1xuZXhwb3J0IHsgQXdzQ2xpQ29tcGF0aWJsZSB9IGZyb20gJy4vYXdzY2xpLWNvbXBhdGlibGUnO1xuZXhwb3J0IHsgc2V0U2RrVHJhY2luZyB9IGZyb20gJy4vdHJhY2luZyc7XG5leHBvcnQgeyBDcmVkZW50aWFsUGx1Z2lucyB9IGZyb20gJy4vY3JlZGVudGlhbC1wbHVnaW5zJztcbmV4cG9ydCB7IGNyZWRlbnRpYWxzQWJvdXRUb0V4cGlyZSB9IGZyb20gJy4vcHJvdmlkZXItY2FjaGluZyc7XG5leHBvcnQgeyBkZWZhdWx0Q2xpVXNlckFnZW50IH0gZnJvbSAnLi91c2VyLWFnZW50JztcbiJdfQ==