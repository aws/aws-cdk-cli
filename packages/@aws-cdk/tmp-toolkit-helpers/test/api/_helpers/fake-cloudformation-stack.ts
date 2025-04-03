import type { ICloudFormationClient } from '../../../src/api';
import type { Template } from '../../../src/api/cloudformation';
import { CloudFormationStack } from '../../../src/api/cloudformation';
import { StackStatus } from '../../../src/api/stack-events';
import { MockSdk } from '../../_helpers/mock-sdk';

export interface FakeCloudFormationStackProps {
  readonly stackName: string;
  readonly stackId?: string;
  readonly stackStatus?: string;
}

const client = new MockSdk().cloudFormation();
export class FakeCloudformationStack extends CloudFormationStack {
  public readonly client: ICloudFormationClient;
  private readonly props: FakeCloudFormationStackProps;
  private __template: Template;

  public constructor(props: FakeCloudFormationStackProps) {
    super(client, props.stackName);
    this.client = client;
    this.props = props;
    this.__template = {};
  }

  public setTemplate(template: Template): void {
    this.__template = template;
  }

  public async template(): Promise<Template> {
    return Promise.resolve(this.__template);
  }

  public get exists() {
    return this.props.stackId !== undefined;
  }

  public get stackStatus() {
    const status = this.props.stackStatus ?? 'UPDATE_COMPLETE';
    return new StackStatus(status, 'The test said so');
  }

  public get stackId() {
    if (!this.props.stackId) {
      throw new Error('Cannot retrieve stackId from a non-existent stack');
    }
    return this.props.stackId;
  }

  public get outputs(): Record<string, string> {
    return {};
  }
}
