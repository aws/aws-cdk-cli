import type * as cxapi from '@aws-cdk/cx-api';
import type { BootstrapEnvironmentOptions } from './bootstrap-props';
import type { SdkProvider } from '../aws-auth';
import type { SuccessfulDeployStackResult } from '../deployments';
import { type IoHelper } from '../io/private';
export type BootstrapSource = {
    source: 'legacy';
} | {
    source: 'default';
} | {
    source: 'custom';
    templateFile: string;
};
export declare class Bootstrapper {
    private readonly source;
    private readonly ioHelper;
    constructor(source: BootstrapSource | undefined, ioHelper: IoHelper);
    bootstrapEnvironment(environment: cxapi.Environment, sdkProvider: SdkProvider, options?: BootstrapEnvironmentOptions): Promise<SuccessfulDeployStackResult>;
    showTemplate(json: boolean): Promise<void>;
    /**
     * Deploy legacy bootstrap stack
     *
     */
    private legacyBootstrap;
    /**
     * Deploy CI/CD-ready bootstrap stack from template
     *
     */
    private modernBootstrap;
    private getPolicyName;
    private getExamplePermissionsBoundary;
    private validatePolicyName;
    private customBootstrap;
    private loadTemplate;
}
