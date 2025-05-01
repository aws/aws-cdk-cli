import type { CloudFormationStackArtifact, Environment } from '@aws-cdk/cx-api';
import type { SDK, SdkProvider } from '../aws-auth';
import type { IoHelper } from '../io/private';
/**
 * Configuration needed to monitor CloudWatch Log Groups
 * found in a given CloudFormation Stack
 */
export interface FoundLogGroupsResult {
    /**
     * The resolved environment (account/region) that the log
     * groups are deployed in
     */
    readonly env: Environment;
    /**
     * The SDK that can be used to read events from the CloudWatch
     * Log Groups in the given environment
     */
    readonly sdk: SDK;
    /**
     * The names of the relevant CloudWatch Log Groups
     * in the given CloudFormation template
     */
    readonly logGroupNames: string[];
}
export declare function findCloudWatchLogGroups(sdkProvider: SdkProvider, ioHelper: IoHelper, stackArtifact: CloudFormationStackArtifact): Promise<FoundLogGroupsResult>;
