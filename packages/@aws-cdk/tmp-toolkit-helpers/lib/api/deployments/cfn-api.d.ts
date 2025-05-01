import * as cxapi from '@aws-cdk/cx-api';
import type { DescribeChangeSetCommandOutput, DescribeStackResourceDriftsCommandOutput, Parameter, ResourceToImport } from '@aws-sdk/client-cloudformation';
import type { Deployments } from './deployments';
import type { ICloudFormationClient, SdkProvider } from '../aws-auth';
import type { Template, TemplateBodyParameter, TemplateParameter } from '../cloudformation';
import { CloudFormationStack } from '../cloudformation';
import { type IoHelper } from '../io/private';
import type { ResourcesToImport } from '../resource-import';
/**
 * Waits for a ChangeSet to be available for triggering a StackUpdate.
 *
 * Will return a changeset that is either ready to be executed or has no changes.
 * Will throw in other cases.
 *
 * @param cfn           a CloudFormation client
 * @param stackName     the name of the Stack that the ChangeSet belongs to
 * @param changeSetName the name of the ChangeSet
 * @param fetchAll      if true, fetches all pages of the ChangeSet before returning.
 *
 * @returns       the CloudFormation description of the ChangeSet
 */
export declare function waitForChangeSet(cfn: ICloudFormationClient, ioHelper: IoHelper, stackName: string, changeSetName: string, { fetchAll }: {
    fetchAll: boolean;
}): Promise<DescribeChangeSetCommandOutput>;
export type PrepareChangeSetOptions = {
    stack: cxapi.CloudFormationStackArtifact;
    deployments: Deployments;
    uuid: string;
    willExecute: boolean;
    sdkProvider: SdkProvider;
    parameters: {
        [name: string]: string | undefined;
    };
    resourcesToImport?: ResourcesToImport;
    /**
     * Default behavior is to log AWS CloudFormation errors and move on. Set this property to true to instead
     * fail on errors received by AWS CloudFormation.
     *
     * @default false
     */
    failOnError?: boolean;
};
export type CreateChangeSetOptions = {
    cfn: ICloudFormationClient;
    changeSetName: string;
    willExecute: boolean;
    exists: boolean;
    uuid: string;
    stack: cxapi.CloudFormationStackArtifact;
    bodyParameter: TemplateBodyParameter;
    parameters: {
        [name: string]: string | undefined;
    };
    resourcesToImport?: ResourceToImport[];
    role?: string;
};
/**
 * Create a changeset for a diff operation
 */
export declare function createDiffChangeSet(ioHelper: IoHelper, options: PrepareChangeSetOptions): Promise<DescribeChangeSetCommandOutput | undefined>;
/**
 * Uploads the assets that look like templates for this CloudFormation stack
 *
 * This is necessary for any CloudFormation call that needs the template, it may need
 * to be uploaded to an S3 bucket first. We have to follow the instructions in the
 * asset manifest, because technically that is the only place that knows about
 * bucket and assumed roles and such.
 */
export declare function uploadStackTemplateAssets(stack: cxapi.CloudFormationStackArtifact, deployments: Deployments): Promise<void>;
export declare function createChangeSet(ioHelper: IoHelper, options: CreateChangeSetOptions): Promise<DescribeChangeSetCommandOutput>;
/**
 * Return true if the given change set has no changes
 *
 * This must be determined from the status, not the 'Changes' array on the
 * object; the latter can be empty because no resources were changed, but if
 * there are changes to Outputs, the change set can still be executed.
 */
export declare function changeSetHasNoChanges(description: DescribeChangeSetCommandOutput): boolean;
/**
 * Waits for a CloudFormation stack to stabilize in a complete/available state
 * after a delete operation is issued.
 *
 * Fails if the stack is in a FAILED state. Will not fail if the stack was
 * already deleted.
 *
 * @param cfn        a CloudFormation client
 * @param stackName      the name of the stack to wait for after a delete
 *
 * @returns     the CloudFormation description of the stabilized stack after the delete attempt
 */
export declare function waitForStackDelete(cfn: ICloudFormationClient, ioHelper: IoHelper, stackName: string): Promise<CloudFormationStack | undefined>;
/**
 * Waits for a CloudFormation stack to stabilize in a complete/available state
 * after an update/create operation is issued.
 *
 * Fails if the stack is in a FAILED state, ROLLBACK state, or DELETED state.
 *
 * @param cfn        a CloudFormation client
 * @param stackName      the name of the stack to wait for after an update
 *
 * @returns     the CloudFormation description of the stabilized stack after the update attempt
 */
export declare function waitForStackDeploy(cfn: ICloudFormationClient, ioHelper: IoHelper, stackName: string): Promise<CloudFormationStack | undefined>;
/**
 * Wait for a stack to become stable (no longer _IN_PROGRESS), returning it
 */
export declare function stabilizeStack(cfn: ICloudFormationClient, ioHelper: IoHelper, stackName: string): Promise<CloudFormationStack | undefined>;
/**
 * Detect drift for a CloudFormation stack and wait for the detection to complete
 *
 * @param cfn        a CloudFormation client
 * @param ioHelper   helper for IO operations
 * @param stackName  the name of the stack to check for drift
 *
 * @returns     the CloudFormation description of the drift detection results
 */
export declare function detectStackDrift(cfn: ICloudFormationClient, ioHelper: IoHelper, stackName: string): Promise<DescribeStackResourceDriftsCommandOutput>;
/**
 * The set of (formal) parameters that have been declared in a template
 */
export declare class TemplateParameters {
    private readonly params;
    static fromTemplate(template: Template): TemplateParameters;
    constructor(params: Record<string, TemplateParameter>);
    /**
     * Calculate stack parameters to pass from the given desired parameter values
     *
     * Will throw if parameters without a Default value or a Previous value are not
     * supplied.
     */
    supplyAll(updates: Record<string, string | undefined>): ParameterValues;
    /**
     * From the template, the given desired values and the current values, calculate the changes to the stack parameters
     *
     * Will take into account parameters already set on the template (will emit
     * 'UsePreviousValue: true' for those unless the value is changed), and will
     * throw if parameters without a Default value or a Previous value are not
     * supplied.
     */
    updateExisting(updates: Record<string, string | undefined>, previousValues: Record<string, string>): ParameterValues;
}
/**
 * The set of parameters we're going to pass to a Stack
 */
export declare class ParameterValues {
    private readonly formalParams;
    readonly values: Record<string, string>;
    readonly apiParameters: Parameter[];
    constructor(formalParams: Record<string, TemplateParameter>, updates: Record<string, string | undefined>, previousValues?: Record<string, string>);
    /**
     * Whether this set of parameter updates will change the actual stack values
     */
    hasChanges(currentValues: Record<string, string>): ParameterChanges;
}
export type ParameterChanges = boolean | 'ssm';
