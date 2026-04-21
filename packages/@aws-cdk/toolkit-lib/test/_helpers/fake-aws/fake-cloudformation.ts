import { CloudFormationClientResolvedConfig, ListStacksCommand, ListStacksCommandInput, ListStacksCommandOutput, ServiceInputTypes, ServiceOutputTypes, StackSummary } from "@aws-sdk/client-cloudformation";
import { AwsStub } from "aws-sdk-client-mock";

export interface FakeCloudFormationBehaviorOptions {
  /**
   * Non-standard page size to ensure the API calls that need to do pagination actually do it
   */
  readonly pageSize?: number;
}

export class FakeCloudFormation {
  private behavior: FakeCloudFormationBehaviorOptions = {};
  private stacks: InMemoryStack[] = [];
  private pageSize: number = 5;

  constructor() {
    this.reset();
  }

  public reset(behavior?: FakeCloudFormationBehaviorOptions) {
    this.behavior = behavior ?? {};
    this.pageSize = behavior?.pageSize ?? 5;
    this.stacks = [];
  }

  public installUsingAwsMock(mock: AwsStub<ServiceInputTypes, ServiceOutputTypes, CloudFormationClientResolvedConfig>) {
    mock.on(ListStacksCommand).callsFake(this.listStacks.bind(this));
  }

  private async listStacks(input: ListStacksCommandInput): Promise<ListStacksCommandOutput> {
    // Use StackName as NextToken
    const startIndex = input.NextToken ? this.stacks.findIndex(s => s.summary.StackName === input.NextToken) : 0;
    const page = this.stacks.slice(startIndex, startIndex + this.pageSize);

    // TODO: Respect input.StackStatusFilter

    return {
      StackSummaries: page.map((s) => s.summary),
      NextToken: this.stacks[startIndex + this.pageSize]?.summary.StackName,
      $metadata: {},
    };
  }

  // TODO: Other commands
}

interface InMemoryStack {
  readonly summary: StackSummary;
}