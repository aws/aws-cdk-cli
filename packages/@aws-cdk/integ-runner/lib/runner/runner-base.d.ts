import type { ICdk } from '@aws-cdk/cdk-cli-wrapper';
import type { TestCase, DefaultCdkOptions } from '@aws-cdk/cloud-assembly-schema';
import { IntegTestSuite, LegacyIntegTestSuite } from './integ-test-suite';
import type { IntegTest } from './integration-tests';
import type { DestructiveChange } from '../workers/common';
/**
 * Options for creating an integration test runner
 */
export interface IntegRunnerOptions {
    /**
     * Information about the test to run
     */
    readonly test: IntegTest;
    /**
     * The AWS profile to use when invoking the CDK CLI
     *
     * @default - no profile is passed, the default profile is used
     */
    readonly profile?: string;
    /**
     * Additional environment variables that will be available
     * to the CDK CLI
     *
     * @default - no additional environment variables
     */
    readonly env?: {
        [name: string]: string;
    };
    /**
     * tmp cdk.out directory
     *
     * @default - directory will be `cdk-integ.out.${testName}`
     */
    readonly integOutDir?: string;
    /**
     * Instance of the CDK CLI to use
     *
     * @default - CdkCliWrapper
     */
    readonly cdk?: ICdk;
    /**
     * Show output from running integration tests
     *
     * @default false
     */
    readonly showOutput?: boolean;
}
/**
 * The different components of a test name
 */
/**
 * Represents an Integration test runner
 */
export declare abstract class IntegRunner {
    /**
     * The directory where the snapshot will be stored
     */
    readonly snapshotDir: string;
    /**
     * An instance of the CDK  CLI
     */
    readonly cdk: ICdk;
    /**
     * Pretty name of the test
     */
    readonly testName: string;
    /**
     * The value used in the '--app' CLI parameter
     *
     * Path to the integ test source file, relative to `this.directory`.
     */
    protected readonly cdkApp: string;
    /**
     * The path where the `cdk.context.json` file
     * will be created
     */
    protected readonly cdkContextPath: string;
    /**
     * The test suite from the existing snapshot
     */
    protected readonly expectedTestSuite?: IntegTestSuite | LegacyIntegTestSuite;
    /**
     * The test suite from the new "actual" snapshot
     */
    protected readonly actualTestSuite: IntegTestSuite | LegacyIntegTestSuite;
    /**
     * The working directory that the integration tests will be
     * executed from
     */
    protected readonly directory: string;
    /**
     * The test to run
     */
    protected readonly test: IntegTest;
    /**
     * Default options to pass to the CDK CLI
     */
    protected readonly defaultArgs: DefaultCdkOptions;
    /**
     * The directory where the CDK will be synthed to
     *
     * Relative to cwd.
     */
    protected readonly cdkOutDir: string;
    protected readonly profile?: string;
    protected _destructiveChanges?: DestructiveChange[];
    private legacyContext?;
    protected isLegacyTest?: boolean;
    constructor(options: IntegRunnerOptions);
    /**
     * Return the list of expected (i.e. existing) test cases for this integration test
     */
    expectedTests(): {
        [testName: string]: TestCase;
    } | undefined;
    /**
     * Return the list of actual (i.e. new) test cases for this integration test
     */
    actualTests(): {
        [testName: string]: TestCase;
    } | undefined;
    /**
     * Generate a new "actual" snapshot which will be compared to the
     * existing "expected" snapshot
     * This will synth and then load the integration test manifest
     */
    generateActualSnapshot(): IntegTestSuite | LegacyIntegTestSuite;
    /**
     * Returns true if a snapshot already exists for this test
     */
    hasSnapshot(): boolean;
    /**
     * Load the integ manifest which contains information
     * on how to execute the tests
     * First we try and load the manifest from the integ manifest (i.e. integ.json)
     * from the cloud assembly. If it doesn't exist, then we fallback to the
     * "legacy mode" and create a manifest from pragma
     */
    protected loadManifest(dir?: string): IntegTestSuite | LegacyIntegTestSuite;
    protected cleanup(): void;
    /**
     * If there are any destructive changes to a stack then this will record
     * those in the manifest.json file
     */
    private renderTraceData;
    /**
     * In cases where we do not want to retain the assets,
     * for example, if the assets are very large.
     *
     * Since it is possible to disable the update workflow for individual test
     * cases, this needs to first get a list of stacks that have the update workflow
     * disabled and then delete assets that relate to that stack. It does that
     * by reading the asset manifest for the stack and deleting the asset source
     */
    protected removeAssetsFromSnapshot(): void;
    /**
     * Remove the asset cache (.cache/) files from the snapshot.
     * These are a cache of the asset zips, but we are fine with
     * re-zipping on deploy
     */
    protected removeAssetsCacheFromSnapshot(): void;
    /**
     * Create the new snapshot.
     *
     * If lookups are enabled, then we need create the snapshot by synthing again
     * with the dummy context so that each time the test is run on different machines
     * (and with different context/env) the diff will not change.
     *
     * If lookups are disabled (which means the stack is env agnostic) then just copy
     * the assembly that was output by the deployment
     */
    protected createSnapshot(): void;
    /**
     * Perform some cleanup steps after the snapshot is created
     * Anytime the snapshot needs to be modified after creation
     * the logic should live here.
     */
    private cleanupSnapshot;
    protected getContext(additionalContext?: Record<string, any>): Record<string, any>;
}
export declare const DEFAULT_SYNTH_OPTIONS: {
    context: {
        "aws:cdk:availability-zones:fallback": string[];
        'availability-zones:account=12345678:region=test-region': string[];
        'ssm:account=12345678:parameterName=/aws/service/ami-amazon-linux-latest/amzn-ami-hvm-x86_64-gp2:region=test-region': string;
        'ssm:account=12345678:parameterName=/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2:region=test-region': string;
        'ssm:account=12345678:parameterName=/aws/service/ecs/optimized-ami/amazon-linux/recommended:region=test-region': string;
        'ami:account=12345678:filters.image-type.0=machine:filters.name.0=amzn-ami-vpc-nat-*:filters.state.0=available:owners.0=amazon:region=test-region': string;
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': {
            vpcId: string;
            subnetGroups: {
                type: string;
                name: string;
                subnets: {
                    subnetId: string;
                    availabilityZone: string;
                    routeTableId: string;
                }[];
            }[];
        };
    };
    env: {
        CDK_INTEG_ACCOUNT: string;
        CDK_INTEG_REGION: string;
        CDK_INTEG_HOSTED_ZONE_ID: string;
        CDK_INTEG_HOSTED_ZONE_NAME: string;
        CDK_INTEG_DOMAIN_NAME: string;
        CDK_INTEG_CERT_ARN: string;
        CDK_INTEG_SUBNET_ID: string;
    };
};
/**
 * Return the currently recommended flags for `aws-cdk-lib`.
 *
 * These have been built into the CLI at build time. If this ever gets changed
 * back to a dynamic load, remember that this source file may be bundled into
 * a JavaScript bundle, and `__dirname` might not point where you think it does.
 */
export declare function currentlyRecommendedAwsCdkLibFlags(): {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": boolean;
    "@aws-cdk/core:checkSecretUsage": boolean;
    "@aws-cdk/core:target-partitions": string[];
    "@aws-cdk-containers/ecs-service-extensions:enableDefaultLogDriver": boolean;
    "@aws-cdk/aws-ec2:uniqueImdsv2TemplateName": boolean;
    "@aws-cdk/aws-ecs:arnFormatIncludesClusterName": boolean;
    "@aws-cdk/aws-iam:minimizePolicies": boolean;
    "@aws-cdk/core:validateSnapshotRemovalPolicy": boolean;
    "@aws-cdk/aws-codepipeline:crossAccountKeyAliasStackSafeResourceName": boolean;
    "@aws-cdk/aws-s3:createDefaultLoggingPolicy": boolean;
    "@aws-cdk/aws-sns-subscriptions:restrictSqsDescryption": boolean;
    "@aws-cdk/aws-apigateway:disableCloudWatchRole": boolean;
    "@aws-cdk/core:enablePartitionLiterals": boolean;
    "@aws-cdk/aws-events:eventsTargetQueueSameAccount": boolean;
    "@aws-cdk/aws-ecs:disableExplicitDeploymentControllerForCircuitBreaker": boolean;
    "@aws-cdk/aws-iam:importedRoleStackSafeDefaultPolicyName": boolean;
    "@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy": boolean;
    "@aws-cdk/aws-route53-patters:useCertificate": boolean;
    "@aws-cdk/customresources:installLatestAwsSdkDefault": boolean;
    "@aws-cdk/aws-rds:databaseProxyUniqueResourceName": boolean;
    "@aws-cdk/aws-codedeploy:removeAlarmsFromDeploymentGroup": boolean;
    "@aws-cdk/aws-apigateway:authorizerChangeDeploymentLogicalId": boolean;
    "@aws-cdk/aws-ec2:launchTemplateDefaultUserData": boolean;
    "@aws-cdk/aws-secretsmanager:useAttachedSecretResourcePolicyForSecretTargetAttachments": boolean;
    "@aws-cdk/aws-redshift:columnId": boolean;
    "@aws-cdk/aws-stepfunctions-tasks:enableEmrServicePolicyV2": boolean;
    "@aws-cdk/aws-ec2:restrictDefaultSecurityGroup": boolean;
    "@aws-cdk/aws-apigateway:requestValidatorUniqueId": boolean;
    "@aws-cdk/aws-kms:aliasNameRef": boolean;
    "@aws-cdk/aws-autoscaling:generateLaunchTemplateInsteadOfLaunchConfig": boolean;
    "@aws-cdk/core:includePrefixInUniqueNameGeneration": boolean;
    "@aws-cdk/aws-efs:denyAnonymousAccess": boolean;
    "@aws-cdk/aws-opensearchservice:enableOpensearchMultiAzWithStandby": boolean;
    "@aws-cdk/aws-lambda-nodejs:useLatestRuntimeVersion": boolean;
    "@aws-cdk/aws-efs:mountTargetOrderInsensitiveLogicalId": boolean;
    "@aws-cdk/aws-rds:auroraClusterChangeScopeOfInstanceParameterGroupWithEachParameters": boolean;
    "@aws-cdk/aws-appsync:useArnForSourceApiAssociationIdentifier": boolean;
    "@aws-cdk/aws-rds:preventRenderingDeprecatedCredentials": boolean;
    "@aws-cdk/aws-codepipeline-actions:useNewDefaultBranchForCodeCommitSource": boolean;
    "@aws-cdk/aws-cloudwatch-actions:changeLambdaPermissionLogicalIdForLambdaAction": boolean;
    "@aws-cdk/aws-codepipeline:crossAccountKeysDefaultValueToFalse": boolean;
    "@aws-cdk/aws-codepipeline:defaultPipelineTypeToV2": boolean;
    "@aws-cdk/aws-kms:reduceCrossAccountRegionPolicyScope": boolean;
    "@aws-cdk/aws-eks:nodegroupNameAttribute": boolean;
    "@aws-cdk/aws-ec2:ebsDefaultGp3Volume": boolean;
    "@aws-cdk/aws-ecs:removeDefaultDeploymentAlarm": boolean;
    "@aws-cdk/custom-resources:logApiResponseDataPropertyTrueDefault": boolean;
    "@aws-cdk/aws-s3:keepNotificationInImportedBucket": boolean;
    "@aws-cdk/aws-ecs:enableImdsBlockingDeprecatedFeature": boolean;
    "@aws-cdk/aws-ecs:disableEcsImdsBlocking": boolean;
    "@aws-cdk/aws-ecs:reduceEc2FargateCloudWatchPermissions": boolean;
    "@aws-cdk/aws-dynamodb:resourcePolicyPerReplica": boolean;
    "@aws-cdk/aws-ec2:ec2SumTImeoutEnabled": boolean;
    "@aws-cdk/aws-appsync:appSyncGraphQLAPIScopeLambdaPermission": boolean;
    "@aws-cdk/aws-rds:setCorrectValueForDatabaseInstanceReadReplicaInstanceResourceId": boolean;
    "@aws-cdk/core:cfnIncludeRejectComplexResourceUpdateCreatePolicyIntrinsics": boolean;
    "@aws-cdk/aws-lambda-nodejs:sdkV3ExcludeSmithyPackages": boolean;
    "@aws-cdk/aws-stepfunctions-tasks:fixRunEcsTaskPolicy": boolean;
    "@aws-cdk/aws-ec2:bastionHostUseAmazonLinux2023ByDefault": boolean;
    "@aws-cdk/aws-route53-targets:userPoolDomainNameMethodWithoutCustomResource": boolean;
    "@aws-cdk/aws-elasticloadbalancingV2:albDualstackWithoutPublicIpv4SecurityGroupRulesDefault": boolean;
    "@aws-cdk/aws-iam:oidcRejectUnauthorizedConnections": boolean;
    "@aws-cdk/core:enableAdditionalMetadataCollection": boolean;
    "@aws-cdk/aws-lambda:createNewPoliciesWithAddToRolePolicy": boolean;
    "@aws-cdk/aws-s3:setUniqueReplicationRoleName": boolean;
};
