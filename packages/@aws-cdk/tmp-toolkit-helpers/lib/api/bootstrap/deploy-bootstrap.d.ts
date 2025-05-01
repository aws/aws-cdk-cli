import type { Environment } from '@aws-cdk/cx-api';
import type { BootstrapEnvironmentOptions } from './bootstrap-props';
import type { SDK, SdkProvider } from '../aws-auth';
import type { SuccessfulDeployStackResult } from '../deployments';
import { type IoHelper } from '../io/private';
import { ToolkitInfo } from '../toolkit-info';
/**
 * A class to hold state around stack bootstrapping
 *
 * This class exists so we can break bootstrapping into 2 phases:
 *
 * ```ts
 * const current = BootstrapStack.lookup(...);
 * // ...
 * current.update(newTemplate, ...);
 * ```
 *
 * And do something in between the two phases (such as look at the
 * current bootstrap stack and doing something intelligent).
 */
export declare class BootstrapStack {
    private readonly sdkProvider;
    private readonly sdk;
    private readonly resolvedEnvironment;
    private readonly toolkitStackName;
    private readonly currentToolkitInfo;
    private readonly ioHelper;
    static lookup(sdkProvider: SdkProvider, environment: Environment, toolkitStackName: string, ioHelper: IoHelper): Promise<BootstrapStack>;
    protected constructor(sdkProvider: SdkProvider, sdk: SDK, resolvedEnvironment: Environment, toolkitStackName: string, currentToolkitInfo: ToolkitInfo, ioHelper: IoHelper);
    get parameters(): Record<string, string>;
    get terminationProtection(): boolean | undefined;
    partition(): Promise<string>;
    /**
     * Perform the actual deployment of a bootstrap stack, given a template and some parameters
     */
    update(template: any, parameters: Record<string, string | undefined>, options: Omit<BootstrapEnvironmentOptions, 'parameters'>): Promise<SuccessfulDeployStackResult>;
}
export declare function bootstrapVersionFromTemplate(template: any): number;
export declare function bootstrapVariantFromTemplate(template: any): string;
