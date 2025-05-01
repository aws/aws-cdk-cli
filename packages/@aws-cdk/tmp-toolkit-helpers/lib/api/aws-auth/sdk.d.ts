import type { FunctionConfiguration, GetSchemaCreationStatusCommandInput, GetSchemaCreationStatusCommandOutput, ListFunctionsCommandInput, StartSchemaCreationCommandInput, StartSchemaCreationCommandOutput, UpdateApiKeyCommandInput, UpdateApiKeyCommandOutput, UpdateFunctionCommandInput, UpdateFunctionCommandOutput, UpdateResolverCommandInput, UpdateResolverCommandOutput } from '@aws-sdk/client-appsync';
import type { GetResourceCommandInput, GetResourceCommandOutput, ListResourcesCommandInput, ListResourcesCommandOutput } from '@aws-sdk/client-cloudcontrol';
import type { ContinueUpdateRollbackCommandInput, ContinueUpdateRollbackCommandOutput, DescribeStackEventsCommandOutput, DescribeStackResourcesCommandInput, DescribeStackResourcesCommandOutput, ListStacksCommandInput, ListStacksCommandOutput, RollbackStackCommandInput, RollbackStackCommandOutput, StackResourceSummary, CreateChangeSetCommandInput, CreateChangeSetCommandOutput, CreateGeneratedTemplateCommandInput, CreateGeneratedTemplateCommandOutput, CreateStackCommandInput, CreateStackCommandOutput, DeleteChangeSetCommandInput, DeleteChangeSetCommandOutput, DeleteGeneratedTemplateCommandInput, DeleteGeneratedTemplateCommandOutput, DeleteStackCommandInput, DeleteStackCommandOutput, DescribeChangeSetCommandInput, DescribeChangeSetCommandOutput, DescribeGeneratedTemplateCommandInput, DescribeGeneratedTemplateCommandOutput, DescribeResourceScanCommandInput, DescribeResourceScanCommandOutput, DescribeStackEventsCommandInput, DescribeStacksCommandInput, DescribeStacksCommandOutput, ExecuteChangeSetCommandInput, ExecuteChangeSetCommandOutput, GetGeneratedTemplateCommandInput, GetGeneratedTemplateCommandOutput, GetTemplateCommandInput, GetTemplateCommandOutput, GetTemplateSummaryCommandInput, GetTemplateSummaryCommandOutput, ListExportsCommandInput, ListExportsCommandOutput, ListResourceScanRelatedResourcesCommandInput, ListResourceScanRelatedResourcesCommandOutput, ListResourceScanResourcesCommandInput, ListResourceScanResourcesCommandOutput, ListResourceScansCommandInput, ListResourceScansCommandOutput, ListStackResourcesCommandInput, StartResourceScanCommandInput, StartResourceScanCommandOutput, UpdateStackCommandInput, UpdateStackCommandOutput, UpdateTerminationProtectionCommandInput, UpdateTerminationProtectionCommandOutput, StackSummary, DescribeStackDriftDetectionStatusCommandInput, DescribeStackDriftDetectionStatusCommandOutput, DescribeStackResourceDriftsCommandOutput, DetectStackDriftCommandInput, DetectStackDriftCommandOutput, DetectStackResourceDriftCommandInput, DetectStackResourceDriftCommandOutput, DescribeStackResourceDriftsCommandInput } from '@aws-sdk/client-cloudformation';
import type { FilterLogEventsCommandInput, FilterLogEventsCommandOutput, DescribeLogGroupsCommandInput, DescribeLogGroupsCommandOutput } from '@aws-sdk/client-cloudwatch-logs';
import { type UpdateProjectCommandInput, type UpdateProjectCommandOutput } from '@aws-sdk/client-codebuild';
import { type DescribeAvailabilityZonesCommandInput, type DescribeAvailabilityZonesCommandOutput, type DescribeImagesCommandInput, type DescribeImagesCommandOutput, type DescribeInstancesCommandInput, type DescribeInstancesCommandOutput, type DescribeRouteTablesCommandInput, type DescribeRouteTablesCommandOutput, type DescribeSecurityGroupsCommandInput, type DescribeSecurityGroupsCommandOutput, type DescribeSubnetsCommandInput, type DescribeSubnetsCommandOutput, type DescribeVpcEndpointServicesCommandInput, type DescribeVpcEndpointServicesCommandOutput, type DescribeVpcsCommandInput, type DescribeVpcsCommandOutput, type DescribeVpnGatewaysCommandInput, type DescribeVpnGatewaysCommandOutput } from '@aws-sdk/client-ec2';
import type { BatchDeleteImageCommandInput, BatchDeleteImageCommandOutput, ListImagesCommandInput, ListImagesCommandOutput, PutImageCommandInput, PutImageCommandOutput, BatchGetImageCommandInput, BatchGetImageCommandOutput, CreateRepositoryCommandInput, CreateRepositoryCommandOutput, DescribeImagesCommandInput as ECRDescribeImagesCommandInput, DescribeImagesCommandOutput as ECRDescribeImagesCommandOutput, DescribeRepositoriesCommandInput, DescribeRepositoriesCommandOutput, GetAuthorizationTokenCommandInput, GetAuthorizationTokenCommandOutput, PutImageScanningConfigurationCommandInput, PutImageScanningConfigurationCommandOutput } from '@aws-sdk/client-ecr';
import type { DescribeServicesCommandInput, RegisterTaskDefinitionCommandInput, ListClustersCommandInput, ListClustersCommandOutput, RegisterTaskDefinitionCommandOutput, UpdateServiceCommandInput, UpdateServiceCommandOutput } from '@aws-sdk/client-ecs';
import type { Listener, LoadBalancer, DescribeListenersCommandInput, DescribeListenersCommandOutput, DescribeLoadBalancersCommandInput, DescribeLoadBalancersCommandOutput, DescribeTagsCommandInput, DescribeTagsCommandOutput } from '@aws-sdk/client-elastic-load-balancing-v2';
import { type CreatePolicyCommandInput, type CreatePolicyCommandOutput, type GetPolicyCommandInput, type GetPolicyCommandOutput, type GetRoleCommandInput, type GetRoleCommandOutput } from '@aws-sdk/client-iam';
import { type DescribeKeyCommandInput, type DescribeKeyCommandOutput, type ListAliasesCommandInput, type ListAliasesCommandOutput } from '@aws-sdk/client-kms';
import { type InvokeCommandInput, type InvokeCommandOutput, type PublishVersionCommandInput, type PublishVersionCommandOutput, type UpdateAliasCommandInput, type UpdateAliasCommandOutput, type UpdateFunctionCodeCommandInput, type UpdateFunctionCodeCommandOutput, type UpdateFunctionConfigurationCommandInput, type UpdateFunctionConfigurationCommandOutput } from '@aws-sdk/client-lambda';
import { type GetHostedZoneCommandInput, type GetHostedZoneCommandOutput, type ListHostedZonesByNameCommandInput, type ListHostedZonesByNameCommandOutput, type ListHostedZonesCommandInput, type ListHostedZonesCommandOutput } from '@aws-sdk/client-route-53';
import type { DeleteObjectsCommandInput, DeleteObjectsCommandOutput, DeleteObjectTaggingCommandInput, DeleteObjectTaggingCommandOutput, GetObjectTaggingCommandInput, GetObjectTaggingCommandOutput, PutObjectTaggingCommandInput, PutObjectTaggingCommandOutput, CompleteMultipartUploadCommandOutput, GetBucketEncryptionCommandInput, GetBucketEncryptionCommandOutput, GetBucketLocationCommandInput, GetBucketLocationCommandOutput, GetObjectCommandInput, GetObjectCommandOutput, ListObjectsV2CommandInput, ListObjectsV2CommandOutput, PutObjectCommandInput } from '@aws-sdk/client-s3';
import { type GetSecretValueCommandInput, type GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import type { UpdateStateMachineCommandInput, UpdateStateMachineCommandOutput } from '@aws-sdk/client-sfn';
import { type GetParameterCommandInput, type GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import type { NodeHttpHandlerOptions } from '@smithy/node-http-handler';
import type { AwsCredentialIdentityProvider, Logger } from '@smithy/types';
import { ConfiguredRetryStrategy } from '@smithy/util-retry';
import type { WaiterResult } from '@smithy/util-waiter';
import type { Account } from './sdk-provider';
import { type IoHelper } from '../io/private';
export interface S3ClientOptions {
    /**
     * If APIs are used that require MD5 checksums.
     *
     * Some S3 APIs in SDKv2 have a bug that always requires them to use a MD5 checksum.
     * These APIs are not going to be supported in a FIPS environment.
     */
    needsMd5Checksums?: boolean;
}
/**
 * Additional SDK configuration options
 */
export interface SdkOptions {
    /**
     * Additional descriptive strings that indicate where the "AssumeRole" credentials are coming from
     *
     * Will be printed in an error message to help users diagnose auth problems.
     */
    readonly assumeRoleCredentialsSourceDescription?: string;
}
export interface ConfigurationOptions {
    region: string;
    credentials: AwsCredentialIdentityProvider;
    requestHandler: NodeHttpHandlerOptions;
    retryStrategy: ConfiguredRetryStrategy;
    customUserAgent: string;
    logger?: Logger;
    s3DisableBodySigning?: boolean;
    computeChecksums?: boolean;
}
export interface IAppSyncClient {
    getSchemaCreationStatus(input: GetSchemaCreationStatusCommandInput): Promise<GetSchemaCreationStatusCommandOutput>;
    startSchemaCreation(input: StartSchemaCreationCommandInput): Promise<StartSchemaCreationCommandOutput>;
    updateApiKey(input: UpdateApiKeyCommandInput): Promise<UpdateApiKeyCommandOutput>;
    updateFunction(input: UpdateFunctionCommandInput): Promise<UpdateFunctionCommandOutput>;
    updateResolver(input: UpdateResolverCommandInput): Promise<UpdateResolverCommandOutput>;
    listFunctions(input: ListFunctionsCommandInput): Promise<FunctionConfiguration[]>;
}
export interface ICloudControlClient {
    listResources(input: ListResourcesCommandInput): Promise<ListResourcesCommandOutput>;
    getResource(input: GetResourceCommandInput): Promise<GetResourceCommandOutput>;
}
export interface ICloudFormationClient {
    continueUpdateRollback(input: ContinueUpdateRollbackCommandInput): Promise<ContinueUpdateRollbackCommandOutput>;
    createChangeSet(input: CreateChangeSetCommandInput): Promise<CreateChangeSetCommandOutput>;
    createGeneratedTemplate(input: CreateGeneratedTemplateCommandInput): Promise<CreateGeneratedTemplateCommandOutput>;
    createStack(input: CreateStackCommandInput): Promise<CreateStackCommandOutput>;
    deleteChangeSet(input: DeleteChangeSetCommandInput): Promise<DeleteChangeSetCommandOutput>;
    deleteGeneratedTemplate(input: DeleteGeneratedTemplateCommandInput): Promise<DeleteGeneratedTemplateCommandOutput>;
    deleteStack(input: DeleteStackCommandInput): Promise<DeleteStackCommandOutput>;
    describeChangeSet(input: DescribeChangeSetCommandInput): Promise<DescribeChangeSetCommandOutput>;
    describeGeneratedTemplate(input: DescribeGeneratedTemplateCommandInput): Promise<DescribeGeneratedTemplateCommandOutput>;
    describeResourceScan(input: DescribeResourceScanCommandInput): Promise<DescribeResourceScanCommandOutput>;
    describeStackDriftDetectionStatus(input: DescribeStackDriftDetectionStatusCommandInput): Promise<DescribeStackDriftDetectionStatusCommandOutput>;
    describeStacks(input: DescribeStacksCommandInput): Promise<DescribeStacksCommandOutput>;
    describeStackResourceDrifts(input: DescribeStackResourceDriftsCommandInput): Promise<DescribeStackResourceDriftsCommandOutput>;
    describeStackResources(input: DescribeStackResourcesCommandInput): Promise<DescribeStackResourcesCommandOutput>;
    detectStackDrift(input: DetectStackDriftCommandInput): Promise<DetectStackDriftCommandOutput>;
    detectStackResourceDrift(input: DetectStackResourceDriftCommandInput): Promise<DetectStackResourceDriftCommandOutput>;
    executeChangeSet(input: ExecuteChangeSetCommandInput): Promise<ExecuteChangeSetCommandOutput>;
    getGeneratedTemplate(input: GetGeneratedTemplateCommandInput): Promise<GetGeneratedTemplateCommandOutput>;
    getTemplate(input: GetTemplateCommandInput): Promise<GetTemplateCommandOutput>;
    getTemplateSummary(input: GetTemplateSummaryCommandInput): Promise<GetTemplateSummaryCommandOutput>;
    listExports(input: ListExportsCommandInput): Promise<ListExportsCommandOutput>;
    listResourceScanRelatedResources(input: ListResourceScanRelatedResourcesCommandInput): Promise<ListResourceScanRelatedResourcesCommandOutput>;
    listResourceScanResources(input: ListResourceScanResourcesCommandInput): Promise<ListResourceScanResourcesCommandOutput>;
    listResourceScans(input?: ListResourceScansCommandInput): Promise<ListResourceScansCommandOutput>;
    listStacks(input: ListStacksCommandInput): Promise<ListStacksCommandOutput>;
    rollbackStack(input: RollbackStackCommandInput): Promise<RollbackStackCommandOutput>;
    startResourceScan(input: StartResourceScanCommandInput): Promise<StartResourceScanCommandOutput>;
    updateStack(input: UpdateStackCommandInput): Promise<UpdateStackCommandOutput>;
    updateTerminationProtection(input: UpdateTerminationProtectionCommandInput): Promise<UpdateTerminationProtectionCommandOutput>;
    describeStackEvents(input: DescribeStackEventsCommandInput): Promise<DescribeStackEventsCommandOutput>;
    listStackResources(input: ListStackResourcesCommandInput): Promise<StackResourceSummary[]>;
    paginatedListStacks(input: ListStacksCommandInput): Promise<StackSummary[]>;
}
export interface ICloudWatchLogsClient {
    describeLogGroups(input: DescribeLogGroupsCommandInput): Promise<DescribeLogGroupsCommandOutput>;
    filterLogEvents(input: FilterLogEventsCommandInput): Promise<FilterLogEventsCommandOutput>;
}
export interface ICodeBuildClient {
    updateProject(input: UpdateProjectCommandInput): Promise<UpdateProjectCommandOutput>;
}
export interface IEC2Client {
    describeAvailabilityZones(input: DescribeAvailabilityZonesCommandInput): Promise<DescribeAvailabilityZonesCommandOutput>;
    describeImages(input: DescribeImagesCommandInput): Promise<DescribeImagesCommandOutput>;
    describeInstances(input: DescribeInstancesCommandInput): Promise<DescribeInstancesCommandOutput>;
    describeRouteTables(input: DescribeRouteTablesCommandInput): Promise<DescribeRouteTablesCommandOutput>;
    describeSecurityGroups(input: DescribeSecurityGroupsCommandInput): Promise<DescribeSecurityGroupsCommandOutput>;
    describeSubnets(input: DescribeSubnetsCommandInput): Promise<DescribeSubnetsCommandOutput>;
    describeVpcEndpointServices(input: DescribeVpcEndpointServicesCommandInput): Promise<DescribeVpcEndpointServicesCommandOutput>;
    describeVpcs(input: DescribeVpcsCommandInput): Promise<DescribeVpcsCommandOutput>;
    describeVpnGateways(input: DescribeVpnGatewaysCommandInput): Promise<DescribeVpnGatewaysCommandOutput>;
}
export interface IECRClient {
    batchDeleteImage(input: BatchDeleteImageCommandInput): Promise<BatchDeleteImageCommandOutput>;
    batchGetImage(input: BatchGetImageCommandInput): Promise<BatchGetImageCommandOutput>;
    createRepository(input: CreateRepositoryCommandInput): Promise<CreateRepositoryCommandOutput>;
    describeImages(input: ECRDescribeImagesCommandInput): Promise<ECRDescribeImagesCommandOutput>;
    describeRepositories(input: DescribeRepositoriesCommandInput): Promise<DescribeRepositoriesCommandOutput>;
    getAuthorizationToken(input: GetAuthorizationTokenCommandInput): Promise<GetAuthorizationTokenCommandOutput>;
    listImages(input: ListImagesCommandInput): Promise<ListImagesCommandOutput>;
    putImage(input: PutImageCommandInput): Promise<PutImageCommandOutput>;
    putImageScanningConfiguration(input: PutImageScanningConfigurationCommandInput): Promise<PutImageScanningConfigurationCommandOutput>;
}
export interface IECSClient {
    listClusters(input: ListClustersCommandInput): Promise<ListClustersCommandOutput>;
    registerTaskDefinition(input: RegisterTaskDefinitionCommandInput): Promise<RegisterTaskDefinitionCommandOutput>;
    updateService(input: UpdateServiceCommandInput): Promise<UpdateServiceCommandOutput>;
    waitUntilServicesStable(input: DescribeServicesCommandInput): Promise<WaiterResult>;
}
export interface IElasticLoadBalancingV2Client {
    describeListeners(input: DescribeListenersCommandInput): Promise<DescribeListenersCommandOutput>;
    describeLoadBalancers(input: DescribeLoadBalancersCommandInput): Promise<DescribeLoadBalancersCommandOutput>;
    describeTags(input: DescribeTagsCommandInput): Promise<DescribeTagsCommandOutput>;
    paginateDescribeListeners(input: DescribeListenersCommandInput): Promise<Listener[]>;
    paginateDescribeLoadBalancers(input: DescribeLoadBalancersCommandInput): Promise<LoadBalancer[]>;
}
export interface IIAMClient {
    createPolicy(input: CreatePolicyCommandInput): Promise<CreatePolicyCommandOutput>;
    getPolicy(input: GetPolicyCommandInput): Promise<GetPolicyCommandOutput>;
    getRole(input: GetRoleCommandInput): Promise<GetRoleCommandOutput>;
}
export interface IKMSClient {
    describeKey(input: DescribeKeyCommandInput): Promise<DescribeKeyCommandOutput>;
    listAliases(input: ListAliasesCommandInput): Promise<ListAliasesCommandOutput>;
}
export interface ILambdaClient {
    invokeCommand(input: InvokeCommandInput): Promise<InvokeCommandOutput>;
    publishVersion(input: PublishVersionCommandInput): Promise<PublishVersionCommandOutput>;
    updateAlias(input: UpdateAliasCommandInput): Promise<UpdateAliasCommandOutput>;
    updateFunctionCode(input: UpdateFunctionCodeCommandInput): Promise<UpdateFunctionCodeCommandOutput>;
    updateFunctionConfiguration(input: UpdateFunctionConfigurationCommandInput): Promise<UpdateFunctionConfigurationCommandOutput>;
    waitUntilFunctionUpdated(delaySeconds: number, input: UpdateFunctionConfigurationCommandInput): Promise<WaiterResult>;
}
export interface IRoute53Client {
    getHostedZone(input: GetHostedZoneCommandInput): Promise<GetHostedZoneCommandOutput>;
    listHostedZones(input: ListHostedZonesCommandInput): Promise<ListHostedZonesCommandOutput>;
    listHostedZonesByName(input: ListHostedZonesByNameCommandInput): Promise<ListHostedZonesByNameCommandOutput>;
}
export interface IS3Client {
    deleteObjects(input: DeleteObjectsCommandInput): Promise<DeleteObjectsCommandOutput>;
    deleteObjectTagging(input: DeleteObjectTaggingCommandInput): Promise<DeleteObjectTaggingCommandOutput>;
    getBucketEncryption(input: GetBucketEncryptionCommandInput): Promise<GetBucketEncryptionCommandOutput>;
    getBucketLocation(input: GetBucketLocationCommandInput): Promise<GetBucketLocationCommandOutput>;
    getObject(input: GetObjectCommandInput): Promise<GetObjectCommandOutput>;
    getObjectTagging(input: GetObjectTaggingCommandInput): Promise<GetObjectTaggingCommandOutput>;
    listObjectsV2(input: ListObjectsV2CommandInput): Promise<ListObjectsV2CommandOutput>;
    putObjectTagging(input: PutObjectTaggingCommandInput): Promise<PutObjectTaggingCommandOutput>;
    upload(input: PutObjectCommandInput): Promise<CompleteMultipartUploadCommandOutput>;
}
export interface ISecretsManagerClient {
    getSecretValue(input: GetSecretValueCommandInput): Promise<GetSecretValueCommandOutput>;
}
export interface ISSMClient {
    getParameter(input: GetParameterCommandInput): Promise<GetParameterCommandOutput>;
}
export interface IStepFunctionsClient {
    updateStateMachine(input: UpdateStateMachineCommandInput): Promise<UpdateStateMachineCommandOutput>;
}
/**
 * Base functionality of SDK without credential fetching
 */
export declare class SDK {
    private readonly credProvider;
    readonly currentRegion: string;
    readonly config: ConfigurationOptions;
    protected readonly logger?: Logger;
    private readonly accountCache;
    /**
     * STS is used to check credential validity, don't do too many retries.
     */
    private readonly stsRetryStrategy;
    /**
     * Whether we have proof that the credentials have not expired
     *
     * We need to do some manual plumbing around this because the JS SDKv2 treats `ExpiredToken`
     * as retriable and we have hefty retries on CFN calls making the CLI hang for a good 15 minutes
     * if the credentials have expired.
     */
    private _credentialsValidated;
    /**
     * A function to create debug messages
     */
    private readonly debug;
    constructor(credProvider: AwsCredentialIdentityProvider, region: string, requestHandler: NodeHttpHandlerOptions, ioHelper: IoHelper, logger?: Logger);
    appendCustomUserAgent(userAgentData?: string): void;
    removeCustomUserAgent(userAgentData: string): void;
    appsync(): IAppSyncClient;
    cloudControl(): ICloudControlClient;
    cloudFormation(): ICloudFormationClient;
    cloudWatchLogs(): ICloudWatchLogsClient;
    codeBuild(): ICodeBuildClient;
    ec2(): IEC2Client;
    ecr(): IECRClient;
    ecs(): IECSClient;
    elbv2(): IElasticLoadBalancingV2Client;
    iam(): IIAMClient;
    kms(): IKMSClient;
    lambda(): ILambdaClient;
    route53(): IRoute53Client;
    s3(): IS3Client;
    secretsManager(): ISecretsManagerClient;
    ssm(): ISSMClient;
    stepFunctions(): IStepFunctionsClient;
    /**
     * The AWS SDK v3 requires a client config and a command in order to get an endpoint for
     * any given service.
     */
    getUrlSuffix(region: string): Promise<string>;
    currentAccount(): Promise<Account>;
    /**
     * Make sure the the current credentials are not expired
     */
    validateCredentials(): Promise<void>;
}
