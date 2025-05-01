import type { SSMParameterContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { IContextProviderMessages } from '.';
import { type SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
/**
 * Plugin to read arbitrary SSM parameter names
 */
export declare class SSMContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    private readonly io;
    constructor(aws: SdkProvider, io: IContextProviderMessages);
    getValue(args: SSMParameterContextQuery): Promise<unknown>;
    /**
     * Gets the value of an SSM Parameter, while not throwin if the parameter does not exist.
     * @param account       the account in which the SSM Parameter is expected to be.
     * @param region        the region in which the SSM Parameter is expected to be.
     * @param parameterName the name of the SSM Parameter
     * @param lookupRoleArn the ARN of the lookup role.
     *
     * @returns the result of the ``GetParameter`` operation.
     *
     * @throws Error if a service error (other than ``ParameterNotFound``) occurs.
     */
    private getSsmParameterValue;
}
