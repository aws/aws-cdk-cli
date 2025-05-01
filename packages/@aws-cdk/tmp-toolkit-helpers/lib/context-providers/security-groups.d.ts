import type { SecurityGroupContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { SecurityGroupContextResponse } from '@aws-cdk/cx-api';
import type { SecurityGroup } from '@aws-sdk/client-ec2';
import { type SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
export declare class SecurityGroupContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    constructor(aws: SdkProvider);
    getValue(args: SecurityGroupContextQuery): Promise<SecurityGroupContextResponse>;
}
/**
 * @internal
 */
export declare function hasAllTrafficEgress(securityGroup: SecurityGroup): boolean;
