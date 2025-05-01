import type { Stack, Tag } from '@aws-sdk/client-cloudformation';
import type { ICloudFormationClient } from '../aws-auth';
import { StackStatus } from '../stack-events';
export interface Template {
    Parameters?: Record<string, TemplateParameter>;
    [section: string]: any;
}
export interface TemplateParameter {
    Type: string;
    Default?: any;
    Description?: string;
    [key: string]: any;
}
/**
 * Represents an (existing) Stack in CloudFormation
 *
 * Bundle and cache some information that we need during deployment (so we don't have to make
 * repeated calls to CloudFormation).
 */
export declare class CloudFormationStack {
    private readonly cfn;
    readonly stackName: string;
    private readonly stack?;
    private readonly retrieveProcessedTemplate;
    static lookup(cfn: ICloudFormationClient, stackName: string, retrieveProcessedTemplate?: boolean): Promise<CloudFormationStack>;
    /**
     * Return a copy of the given stack that does not exist
     *
     * It's a little silly that it needs arguments to do that, but there we go.
     */
    static doesNotExist(cfn: ICloudFormationClient, stackName: string): CloudFormationStack;
    /**
     * From static information (for testing)
     */
    static fromStaticInformation(cfn: ICloudFormationClient, stackName: string, stack: Stack): CloudFormationStack;
    private _template;
    protected constructor(cfn: ICloudFormationClient, stackName: string, stack?: Stack | undefined, retrieveProcessedTemplate?: boolean);
    /**
     * Retrieve the stack's deployed template
     *
     * Cached, so will only be retrieved once. Will return an empty
     * structure if the stack does not exist.
     */
    template(): Promise<Template>;
    /**
     * Whether the stack exists
     */
    get exists(): boolean;
    /**
     * The stack's ID (which is the same as its ARN)
     *
     * Throws if the stack doesn't exist.
     */
    get stackId(): string;
    /**
     * The stack's current outputs
     *
     * Empty object if the stack doesn't exist
     */
    get outputs(): Record<string, string>;
    /**
     * The stack's status
     *
     * Special status NOT_FOUND if the stack does not exist.
     */
    get stackStatus(): StackStatus;
    /**
     * The stack's current tags
     *
     * Empty list if the stack does not exist
     */
    get tags(): Tag[];
    /**
     * SNS Topic ARNs that will receive stack events.
     *
     * Empty list if the stack does not exist
     */
    get notificationArns(): string[];
    /**
     * Return the names of all current parameters to the stack
     *
     * Empty list if the stack does not exist.
     */
    get parameterNames(): string[];
    /**
     * Return the names and values of all current parameters to the stack
     *
     * Empty object if the stack does not exist.
     */
    get parameters(): Record<string, string>;
    /**
     * Return the termination protection of the stack
     */
    get terminationProtection(): boolean | undefined;
    private assertExists;
}
