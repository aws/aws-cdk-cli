import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';
/**
 * Wrap a credential provider in a cache
 *
 * Some credential providers in the SDKv3 are cached (the default Node
 * chain, specifically) but most others are not.
 *
 * Since we want to avoid duplicate calls to `AssumeRole`, or duplicate
 * MFA prompts or what have you, we are going to liberally wrap providers
 * in caches which will return the cached value until it expires.
 */
export declare function makeCachingProvider(provider: AwsCredentialIdentityProvider): AwsCredentialIdentityProvider;
export declare function credentialsAboutToExpire(token: AwsCredentialIdentity): boolean;
