import type { Stack, Tag } from '@aws-sdk/client-cloudformation';
import { formatErrorMessage, deserializeStructure } from '../../util';
import type { ICloudFormationClient } from '../aws-auth';
import { StackStatus } from '../stack-events';
import { ToolkitError } from '../toolkit-error';

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
export class CloudFormationStack {
  public static async lookup(
    cfn: ICloudFormationClient,
    stackName: string,
    retrieveProcessedTemplate: boolean = false,
  ): Promise<CloudFormationStack> {
    try {
      const response = await cfn.describeStacks({ StackName: stackName });
      return new CloudFormationStack(cfn, stackName, response.Stacks && response.Stacks[0], retrieveProcessedTemplate);
    } catch (e: any) {
      if (e.name === 'ValidationError' && formatErrorMessage(e) === `Stack with id ${stackName} does not exist`) {
        return new CloudFormationStack(cfn, stackName, undefined);
      }
      throw e;
    }
  }

  /**
   * Return a copy of the given stack that does not exist
   *
   * It's a little silly that it needs arguments to do that, but there we go.
   */
  public static doesNotExist(cfn: ICloudFormationClient, stackName: string) {
    return new CloudFormationStack(cfn, stackName);
  }

  /**
   * From static information (for testing)
   */
  public static fromStaticInformation(cfn: ICloudFormationClient, stackName: string, stack: Stack) {
    return new CloudFormationStack(cfn, stackName, stack);
  }

  private _template: any;

  protected constructor(
    private readonly cfn: ICloudFormationClient,
    public readonly stackName: string,
    private readonly stack?: Stack,
    private readonly retrieveProcessedTemplate: boolean = false,
  ) {
  }

  /**
   * Retrieve the stack's deployed template
   *
   * Cached, so will only be retrieved once. Will return an empty
   * structure if the stack does not exist.
   */
  public async template(): Promise<Template> {
    if (!this.exists) {
      return {};
    }

    if (this._template === undefined) {
      const response = await this.cfn.getTemplate({
        StackName: this.stackName,
        TemplateStage: this.retrieveProcessedTemplate ? 'Processed' : 'Original',
      });
      this._template = (response.TemplateBody && deserializeStructure(response.TemplateBody)) || {};
    }
    return this._template;
  }

  /**
   * Whether the stack exists
   */
  public get exists() {
    return this.stack !== undefined;
  }

  /**
   * The stack's ID (which is the same as its ARN)
   *
   * Throws if the stack doesn't exist.
   */
  public get stackId() {
    this.assertExists();
    return this.stack!.StackId!;
  }

  /**
   * The stack's current outputs
   *
   * Empty object if the stack doesn't exist
   */
  public get outputs(): Record<string, string> {
    if (!this.exists) {
      return {};
    }
    const result: { [name: string]: string } = {};
    (this.stack!.Outputs || []).forEach((output) => {
      result[output.OutputKey!] = output.OutputValue!;
    });
    return result;
  }

  /**
   * The stack's status
   *
   * Special status NOT_FOUND if the stack does not exist.
   */
  public get stackStatus(): StackStatus {
    if (!this.exists) {
      return new StackStatus('NOT_FOUND', 'Stack not found during lookup');
    }
    return StackStatus.fromStackDescription(this.stack!);
  }

  /**
   * The stack's current tags
   *
   * Empty list if the stack does not exist
   */
  public get tags(): Tag[] {
    return this.stack?.Tags || [];
  }

  /**
   * SNS Topic ARNs that will receive stack events.
   *
   * Empty list if the stack does not exist
   */
  public get notificationArns(): string[] {
    return this.stack?.NotificationARNs ?? [];
  }

  /**
   * Return the names of all current parameters to the stack
   *
   * Empty list if the stack does not exist.
   */
  public get parameterNames(): string[] {
    return Object.keys(this.parameters);
  }

  /**
   * Return the names and values of all current parameters to the stack
   *
   * Empty object if the stack does not exist.
   */
  public get parameters(): Record<string, string> {
    if (!this.exists) {
      return {};
    }
    const ret: Record<string, string> = {};
    for (const param of this.stack!.Parameters ?? []) {
      ret[param.ParameterKey!] = param.ResolvedValue ?? param.ParameterValue!;
    }
    return ret;
  }

  /**
   * Return the termination protection of the stack
   */
  public get terminationProtection(): boolean | undefined {
    return this.stack?.EnableTerminationProtection;
  }

  private assertExists() {
    if (!this.exists) {
      throw new ToolkitError(`No stack named '${this.stackName}'`);
    }
  }
}
