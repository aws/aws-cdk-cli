import { type Environment } from '@aws-cdk/cx-api';
import type { Branded } from '../../util';
import type { SdkProvider } from '../aws-auth';
/**
 * Replace the {ACCOUNT} and {REGION} placeholders in all strings found in a complex object.
 */
export declare function replaceEnvPlaceholders<A extends Record<string, string | undefined>>(object: A, env: Environment, sdkProvider: SdkProvider): Promise<{
    [k in keyof A]: StringWithoutPlaceholders | undefined;
}>;
export type StringWithoutPlaceholders = Branded<string, 'NoPlaceholders'>;
