import type { CcApiContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
export declare class CcApiContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    constructor(aws: SdkProvider);
    /**
     * This returns a data object with the value from CloudControl API result.
     *
     * See the documentation in the Cloud Assembly Schema for the semantics of
     * each query parameter.
     */
    getValue(args: CcApiContextQuery): Promise<any>;
    /**
     * Calls getResource from CC API to get the resource.
     * See https://docs.aws.amazon.com/cli/latest/reference/cloudcontrol/get-resource.html
     *
     * Will always return exactly one resource, or fail.
     */
    private getResource;
    /**
     * Calls listResources from CC API to get the resources and apply args.propertyMatch to find the resources.
     * See https://docs.aws.amazon.com/cli/latest/reference/cloudcontrol/list-resources.html
     *
     * Will return 0 or more resources.
     *
     * Does not currently paginate through more than one result page.
     */
    private listResources;
}
