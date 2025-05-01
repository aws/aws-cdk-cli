import type { SdkProvider } from '../aws-auth';
import type { Settings } from '../settings';
/**
 * If we don't have region/account defined in context, we fall back to the default SDK behavior
 * where region is retrieved from ~/.aws/config and account is based on default credentials provider
 * chain and then STS is queried.
 *
 * This is done opportunistically: for example, if we can't access STS for some reason or the region
 * is not configured, the context value will be 'null' and there could failures down the line. In
 * some cases, synthesis does not require region/account information at all, so that might be perfectly
 * fine in certain scenarios.
 *
 * @param context The context key/value bash.
 */
export declare function prepareDefaultEnvironment(aws: SdkProvider, debugFn: (msg: string) => Promise<void>): Promise<{
    [key: string]: string;
}>;
/**
 * Settings related to synthesis are read from context.
 * The merging of various configuration sources like cli args or cdk.json has already happened.
 * We now need to set the final values to the context.
 */
export declare function prepareContext(settings: Settings, context: {
    [key: string]: any;
}, env: {
    [key: string]: string | undefined;
}, debugFn: (msg: string) => Promise<void>): Promise<{
    [key: string]: any;
}>;
export declare function spaceAvailableForContext(env: {
    [key: string]: string;
}, limit: number): number;
/**
 * Guess the executable from the command-line argument
 *
 * Only do this if the file is NOT marked as executable. If it is,
 * we'll defer to the shebang inside the file itself.
 *
 * If we're on Windows, we ALWAYS take the handler, since it's hard to
 * verify if registry associations have or have not been set up for this
 * file type, so we'll assume the worst and take control.
 */
export declare function guessExecutable(app: string, debugFn: (msg: string) => Promise<void>): Promise<any>;
