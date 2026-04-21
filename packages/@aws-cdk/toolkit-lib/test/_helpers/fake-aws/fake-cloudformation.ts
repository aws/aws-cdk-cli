import {
  type ContinueUpdateRollbackCommandInput,
  type ContinueUpdateRollbackCommandOutput,
  type CreateChangeSetCommandInput,
  type CreateChangeSetCommandOutput,
  type CreateStackCommandInput,
  type CreateStackCommandOutput,
  type DeleteChangeSetCommandInput,
  type DeleteChangeSetCommandOutput,
  type DeleteStackCommandInput,
  type DeleteStackCommandOutput,
  type DescribeChangeSetCommandInput,
  type DescribeChangeSetCommandOutput,
  type DescribeStackEventsCommandInput,
  type DescribeStackEventsCommandOutput,
  type DescribeStacksCommandInput,
  type DescribeStacksCommandOutput,
  type ExecuteChangeSetCommandInput,
  type ExecuteChangeSetCommandOutput,
  type GetTemplateCommandInput,
  type GetTemplateCommandOutput,
  type GetTemplateSummaryCommandInput,
  type GetTemplateSummaryCommandOutput,
  type ListStacksCommandInput,
  type ListStacksCommandOutput,
  type UpdateStackCommandInput,
  type UpdateStackCommandOutput,
  type UpdateTerminationProtectionCommandInput,
  type UpdateTerminationProtectionCommandOutput,
  type Stack,
  type StackEvent,
  type StackSummary,
  type Change,
  type Parameter,
  type Tag,
  type ServiceInputTypes,
  type ServiceOutputTypes,
  type CloudFormationClientResolvedConfig,
  ListStacksCommand,
  CreateStackCommand,
  UpdateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  ExecuteChangeSetCommand,
  DeleteChangeSetCommand,
  GetTemplateCommand,
  GetTemplateSummaryCommand,
  ContinueUpdateRollbackCommand,
  UpdateTerminationProtectionCommand,
} from '@aws-sdk/client-cloudformation';
import type { AwsStub } from 'aws-sdk-client-mock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 0;
function uid() {
  return `${++nextId}-${Date.now().toString(36)}`;
}

function stackArn(name: string) {
  return `arn:aws:cloudformation:us-east-1:123456789012:stack/${name}/${uid()}`;
}

function changeSetArn(_stackName: string, csName: string) {
  return `arn:aws:cloudformation:us-east-1:123456789012:changeSet/${csName}/${uid()}`;
}

function cfnError(code: string, message: string): never {
  const e: any = new Error(message);
  e.name = code;
  throw e;
}

/** Parse a template body string or return the object as-is */
function parseTemplate(body?: string): Record<string, any> {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (e) {
      throw new Error(`Error parsing CFN template: ${body}`);
    }
  }
  return body as any;
}

/** Extract logical resource IDs from a CFN template */
function templateResources(tpl: Record<string, any>): Record<string, any> {
  return tpl.Resources ?? {};
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface InMemoryChangeSet {
  name: string;
  id: string; // ARN
  stackId: string;
  status: string;
  statusReason?: string;
  executionStatus: string;
  changeSetType: string;
  template: Record<string, any>;
  parameters: Parameter[];
  tags: Tag[];
  capabilities: string[];
  description?: string;
  changes: Change[];
  creationTime: Date;
}

interface InMemoryStack {
  name: string;
  id: string; // ARN
  status: string;
  statusReason?: string;
  template: Record<string, any>;
  parameters: Parameter[];
  tags: Tag[];
  capabilities: string[];
  outputs: { OutputKey: string; OutputValue: string }[];
  enableTerminationProtection: boolean;
  roleArn?: string;
  creationTime: Date;
  lastUpdatedTime?: Date;
  deletionTime?: Date;
  changeSets: InMemoryChangeSet[];
  events: StackEvent[];
}

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

export interface FakeCloudFormationBehaviorOptions {
  /** Page size for paginated APIs (default 5) */
  readonly pageSize?: number;
  /** Delay in ms for async operations (default 20) */
  readonly asyncDelay?: number;
  /** When true, all resource operations fail */
  readonly alwaysFailResources?: boolean;
  /** When true, resource operations fail on the first deploy only, then auto-clears */
  readonly failFirstDeploy?: boolean;
}

// ---------------------------------------------------------------------------
// FakeCloudFormation
// ---------------------------------------------------------------------------

/**
 * An in-memory implementation of CloudFormation, to test against
 *
 * The behavior of this model is described in `fake-cloudformation.md`, and must
 * be kept up-to-date with this implementation at all times.
 */
export class FakeCloudFormation {
  private stacks = new Map<string, InMemoryStack>();
  /** Maps change set ARN → stack name, for resolving the stack when only an ARN is provided */
  private changeSetToStack = new Map<string, string>();
  private pageSize = 5;
  private asyncDelay = 20;
  private alwaysFailResources = false;
  private failFirstDeploy = false;

  constructor() {
    this.reset();
  }

  public reset(behavior?: FakeCloudFormationBehaviorOptions) {
    this.stacks = new Map();
    this.changeSetToStack = new Map();
    this.pageSize = behavior?.pageSize ?? 5;
    this.asyncDelay = behavior?.asyncDelay ?? 20;
    this.alwaysFailResources = behavior?.alwaysFailResources ?? false;
    this.failFirstDeploy = behavior?.failFirstDeploy ?? false;
  }

  public firstStack(): InMemoryStack {
    const ret = Array.from(this.stacks.values())[0];
    if (!ret) {
      throw new Error('No in-memory stacks');
    }
    return ret;
  }

  /**
   * Installs this fake implementation using 'aws-sdk-client-mock'
   */
  public installUsingAwsMock(mock: AwsStub<ServiceInputTypes, ServiceOutputTypes, CloudFormationClientResolvedConfig>) {
    mock.on(CreateStackCommand).callsFake(this.createStack.bind(this));
    mock.on(UpdateStackCommand).callsFake(this.updateStack.bind(this));
    mock.on(DeleteStackCommand).callsFake(this.deleteStack.bind(this));
    mock.on(DescribeStacksCommand).callsFake(this.describeStacks.bind(this));
    mock.on(ListStacksCommand).callsFake(this.listStacks.bind(this));
    mock.on(DescribeStackEventsCommand).callsFake(this.describeStackEvents.bind(this));
    mock.on(CreateChangeSetCommand).callsFake(this.createChangeSet.bind(this));
    mock.on(DescribeChangeSetCommand).callsFake(this.describeChangeSet.bind(this));
    mock.on(ExecuteChangeSetCommand).callsFake(this.executeChangeSet.bind(this));
    mock.on(DeleteChangeSetCommand).callsFake(this.deleteChangeSet.bind(this));
    mock.on(GetTemplateCommand).callsFake(this.getTemplate.bind(this));
    mock.on(GetTemplateSummaryCommand).callsFake(this.getTemplateSummary.bind(this));
    mock.on(ContinueUpdateRollbackCommand).callsFake(this.continueUpdateRollback.bind(this));
    mock.on(UpdateTerminationProtectionCommand).callsFake(this.updateTerminationProtection.bind(this));
  }

  // -----------------------------------------------------------------------
  // Stack operations
  // -----------------------------------------------------------------------

  public createStackSync(input: CreateStackCommandInput): CreateStackCommandOutput {
    const { id, stack, template } = this.initCreateStack(input);
    this.finalizeCreateStack(stack, template, input.DisableRollback);
    return { StackId: id, $metadata: {} };
  }

  public async createStack(input: CreateStackCommandInput): Promise<CreateStackCommandOutput> {
    const { id, stack, template } = this.initCreateStack(input);
    this.scheduleAsync(() => {
      this.finalizeCreateStack(stack, template, input.DisableRollback);
    });
    return { StackId: id, $metadata: {} };
  }

  public async updateStack(input: UpdateStackCommandInput): Promise<UpdateStackCommandOutput> {
    const stack = this.requireStack(input.StackName!);
    this.requireStableState(stack);

    const template = input.TemplateBody ? parseTemplate(input.TemplateBody) : stack.template;

    if (JSON.stringify(template) === JSON.stringify(stack.template)
      && JSON.stringify(input.Parameters ?? stack.parameters) === JSON.stringify(stack.parameters)
      && JSON.stringify(input.Tags ?? stack.tags) === JSON.stringify(stack.tags)) {
      cfnError('ValidationError', 'No updates are to be performed.');
    }

    stack.status = 'UPDATE_IN_PROGRESS';
    stack.lastUpdatedTime = new Date();
    this.addEvent(stack, 'UPDATE_IN_PROGRESS', 'User Initiated');

    this.scheduleAsync(() => {
      if (this.shouldFail(template)) {
        if (input.DisableRollback) {
          this.transitionStack(stack, 'UPDATE_FAILED', 'Resource update failed');
        } else {
          this.transitionStack(stack, 'UPDATE_ROLLBACK_IN_PROGRESS', 'Resource update failed');
          this.scheduleAsync(() => {
            this.transitionStack(stack, 'UPDATE_ROLLBACK_COMPLETE');
          });
        }
      } else {
        stack.template = template;
        if (input.Parameters) stack.parameters = input.Parameters;
        if (input.Tags) stack.tags = input.Tags;
        if (input.Capabilities) stack.capabilities = input.Capabilities as string[];
        if (input.RoleARN) stack.roleArn = input.RoleARN;
        this.transitionStack(stack, 'UPDATE_COMPLETE');
      }
    });

    return { StackId: stack.id, $metadata: {} };
  }

  public async deleteStack(input: DeleteStackCommandInput): Promise<DeleteStackCommandOutput> {
    const stack = this.findStackByNameOrId(input.StackName!);
    if (!stack || stack.status === 'DELETE_COMPLETE') {
      // No-op per API docs
      return { $metadata: {} };
    }
    if (stack.enableTerminationProtection) {
      cfnError('ValidationError', `Stack [${stack.name}] cannot be deleted while TerminationProtection is enabled`);
    }

    stack.status = 'DELETE_IN_PROGRESS';
    this.addEvent(stack, 'DELETE_IN_PROGRESS', 'User Initiated');

    this.scheduleAsync(() => {
      stack.deletionTime = new Date();
      this.transitionStack(stack, 'DELETE_COMPLETE');
    });

    return { $metadata: {} };
  }

  public async continueUpdateRollback(input: ContinueUpdateRollbackCommandInput): Promise<ContinueUpdateRollbackCommandOutput> {
    const stack = this.requireStack(input.StackName!);
    if (stack.status !== 'UPDATE_ROLLBACK_FAILED') {
      cfnError('ValidationError', `Stack [${stack.name}] is in ${stack.status} state and can not be continued`);
    }

    stack.status = 'UPDATE_ROLLBACK_IN_PROGRESS';
    this.addEvent(stack, 'UPDATE_ROLLBACK_IN_PROGRESS');

    this.scheduleAsync(() => {
      this.transitionStack(stack, 'UPDATE_ROLLBACK_COMPLETE');
    });

    return { $metadata: {} };
  }

  public async updateTerminationProtection(input: UpdateTerminationProtectionCommandInput): Promise<UpdateTerminationProtectionCommandOutput> {
    const stack = this.requireStack(input.StackName!);
    stack.enableTerminationProtection = input.EnableTerminationProtection ?? false;
    return { StackId: stack.id, $metadata: {} };
  }

  // -----------------------------------------------------------------------
  // Change set operations
  // -----------------------------------------------------------------------

  public createChangeSetSync(input: CreateChangeSetCommandInput): CreateChangeSetCommandOutput {
    const { csId, stack, cs, template } = this.initCreateChangeSet(input);
    this.finalizeCreateChangeSet(stack, cs, template);
    return { Id: csId, StackId: stack.id, $metadata: {} };
  }

  public async createChangeSet(input: CreateChangeSetCommandInput): Promise<CreateChangeSetCommandOutput> {
    const { csId, stack, cs, template } = this.initCreateChangeSet(input);
    this.scheduleAsync(() => {
      this.finalizeCreateChangeSet(stack, cs, template);
    });
    return { Id: csId, StackId: stack.id, $metadata: {} };
  }

  public async describeChangeSet(input: DescribeChangeSetCommandInput): Promise<DescribeChangeSetCommandOutput> {
    const { stack, changeSet: cs } = this.resolveChangeSet(input.ChangeSetName!, input.StackName);

    // Paginate over changes
    const startIndex = input.NextToken ? parseInt(input.NextToken, 10) : 0;
    const page = cs.changes.slice(startIndex, startIndex + this.pageSize);
    const nextIndex = startIndex + this.pageSize;
    const nextToken = nextIndex < cs.changes.length ? String(nextIndex) : undefined;

    return {
      ChangeSetId: cs.id,
      ChangeSetName: cs.name,
      StackId: cs.stackId,
      StackName: stack.name,
      Status: cs.status as any,
      StatusReason: cs.statusReason,
      ExecutionStatus: cs.executionStatus as any,
      Changes: page,
      Parameters: cs.parameters,
      Tags: cs.tags,
      Capabilities: cs.capabilities as any,
      Description: cs.description,
      CreationTime: cs.creationTime,
      NextToken: nextToken,
      $metadata: {},
    };
  }

  public async executeChangeSet(input: ExecuteChangeSetCommandInput): Promise<ExecuteChangeSetCommandOutput> {
    const { stack, changeSet: cs } = this.resolveChangeSet(input.ChangeSetName!, input.StackName);

    if (cs.executionStatus !== 'AVAILABLE') {
      cfnError('InvalidChangeSetStatus', `ChangeSet [${cs.name}] is in ${cs.executionStatus} state and cannot be executed`);
    }

    // Delete all OTHER change sets on this stack (per API docs)
    for (const other of stack.changeSets) {
      if (other.id !== cs.id) {
        this.changeSetToStack.delete(other.id);
      }
    }
    stack.changeSets = stack.changeSets.filter((c) => c.id === cs.id);
    cs.executionStatus = 'EXECUTE_IN_PROGRESS';

    const isCreate = cs.changeSetType === 'CREATE';

    // Apply the template
    stack.template = cs.template;
    if (cs.parameters.length > 0) stack.parameters = cs.parameters;
    if (cs.tags.length > 0) stack.tags = cs.tags;
    if (cs.capabilities.length > 0) stack.capabilities = cs.capabilities;

    const inProgressStatus = isCreate ? 'CREATE_IN_PROGRESS' : 'UPDATE_IN_PROGRESS';
    stack.status = inProgressStatus;
    stack.lastUpdatedTime = new Date();
    this.addEvent(stack, inProgressStatus, 'User Initiated');

    this.scheduleAsync(() => {
      cs.status = 'EXECUTE_COMPLETE';
      cs.executionStatus = 'EXECUTE_COMPLETE';

      if (this.shouldFail(cs.template)) {
        const failedStatus = isCreate ? 'CREATE_FAILED' : 'UPDATE_FAILED';
        if (input.DisableRollback) {
          this.transitionStack(stack, failedStatus, 'Resource operation failed');
        } else {
          const rollbackStatus = isCreate ? 'ROLLBACK_IN_PROGRESS' : 'UPDATE_ROLLBACK_IN_PROGRESS';
          const rollbackComplete = isCreate ? 'ROLLBACK_COMPLETE' : 'UPDATE_ROLLBACK_COMPLETE';
          this.transitionStack(stack, rollbackStatus, 'Resource operation failed');
          this.scheduleAsync(() => {
            this.transitionStack(stack, rollbackComplete);
          });
        }
      } else {
        const completeStatus = isCreate ? 'CREATE_COMPLETE' : 'UPDATE_COMPLETE';
        this.transitionStack(stack, completeStatus);
      }
    });

    return { $metadata: {} };
  }

  public async deleteChangeSet(input: DeleteChangeSetCommandInput): Promise<DeleteChangeSetCommandOutput> {
    const { stack, changeSet: cs } = this.resolveChangeSet(input.ChangeSetName!, input.StackName);

    if (cs.status === 'CREATE_IN_PROGRESS' || cs.status === 'DELETE_IN_PROGRESS') {
      cfnError('InvalidChangeSetStatus', `ChangeSet [${cs.name}] is in ${cs.status} state and cannot be deleted`);
    }

    stack.changeSets = stack.changeSets.filter((c) => c.id !== cs.id);
    this.changeSetToStack.delete(cs.id);
    return { $metadata: {} };
  }

  // -----------------------------------------------------------------------
  // Query operations
  // -----------------------------------------------------------------------

  public async describeStacks(input: DescribeStacksCommandInput): Promise<DescribeStacksCommandOutput> {
    if (input.StackName) {
      const stack = this.findStackByNameOrId(input.StackName);
      if (!stack) {
        cfnError('ValidationError', `Stack with id ${input.StackName} does not exist`);
      }
      return { Stacks: [this.toStackDescription(stack)], $metadata: {} };
    }

    // Return all non-deleted stacks, paginated
    const allStacks = Array.from(this.stacks.values()).filter((s) => s.status !== 'DELETE_COMPLETE');
    const startIndex = input.NextToken ? parseInt(input.NextToken, 10) : 0;
    const page = allStacks.slice(startIndex, startIndex + this.pageSize);
    const nextIndex = startIndex + this.pageSize;

    return {
      Stacks: page.map((s) => this.toStackDescription(s)),
      NextToken: nextIndex < allStacks.length ? String(nextIndex) : undefined,
      $metadata: {},
    };
  }

  public async listStacks(input: ListStacksCommandInput): Promise<ListStacksCommandOutput> {
    let allStacks = Array.from(this.stacks.values());
    if (input.StackStatusFilter && input.StackStatusFilter.length > 0) {
      const filter = new Set(input.StackStatusFilter as string[]);
      allStacks = allStacks.filter((s) => filter.has(s.status));
    }

    const startIndex = input.NextToken ? parseInt(input.NextToken, 10) : 0;
    const page = allStacks.slice(startIndex, startIndex + this.pageSize);
    const nextIndex = startIndex + this.pageSize;

    return {
      StackSummaries: page.map((s) => this.toStackSummary(s)),
      NextToken: nextIndex < allStacks.length ? String(nextIndex) : undefined,
      $metadata: {},
    };
  }

  public async getTemplate(input: GetTemplateCommandInput): Promise<GetTemplateCommandOutput> {
    // If a change set is specified, resolve it (StackName is optional when using an ARN)
    if (input.ChangeSetName) {
      const { changeSet: cs } = this.resolveChangeSet(input.ChangeSetName, input.StackName);
      return {
        TemplateBody: JSON.stringify(cs.template),
        $metadata: {},
      };
    }

    const stack = this.requireStack(input.StackName!);
    return {
      TemplateBody: JSON.stringify(stack.template),
      $metadata: {},
    };
  }

  public async getTemplateSummary(input: GetTemplateSummaryCommandInput): Promise<GetTemplateSummaryCommandOutput> {
    let template: Record<string, any>;
    if (input.TemplateBody) {
      template = parseTemplate(input.TemplateBody);
    } else if (input.StackName) {
      const stack = this.requireStack(input.StackName);
      template = stack.template;
    } else {
      template = {};
    }

    const params = template.Parameters ?? {};
    const paramDeclarations = Object.entries(params).map(([key, val]: [string, any]) => ({
      ParameterKey: key,
      ParameterType: val.Type ?? 'String',
      DefaultValue: val.Default,
      Description: val.Description,
    }));

    const resources = templateResources(template);
    const resourceTypes = Array.from(new Set(Object.values(resources).map((r: any) => r.Type as string)));

    return {
      Parameters: paramDeclarations,
      ResourceTypes: resourceTypes,
      $metadata: {},
    };
  }

  public async describeStackEvents(input: DescribeStackEventsCommandInput): Promise<DescribeStackEventsCommandOutput> {
    const stack = this.requireStack(input.StackName!);
    const startIndex = input.NextToken ? parseInt(input.NextToken, 10) : 0;
    const page = stack.events.slice(startIndex, startIndex + this.pageSize);
    const nextIndex = startIndex + this.pageSize;

    return {
      StackEvents: page,
      NextToken: nextIndex < stack.events.length ? String(nextIndex) : undefined,
      $metadata: {},
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private initCreateStack(input: CreateStackCommandInput): { id: string; stack: InMemoryStack; template: Record<string, any> } {
    const name = input.StackName!;
    const existing = this.stacks.get(name);
    if (existing && existing.status !== 'DELETE_COMPLETE') {
      cfnError('AlreadyExistsException', `Stack [${name}] already exists`);
    }

    const id = stackArn(name);
    const template = parseTemplate(input.TemplateBody);
    const stack: InMemoryStack = {
      name,
      id,
      status: 'CREATE_IN_PROGRESS',
      template,
      parameters: input.Parameters ?? [],
      tags: input.Tags ?? [],
      capabilities: (input.Capabilities as string[]) ?? [],
      outputs: [],
      enableTerminationProtection: input.EnableTerminationProtection ?? false,
      roleArn: input.RoleARN,
      creationTime: new Date(),
      changeSets: [],
      events: [],
    };
    this.stacks.set(name, stack);
    this.addEvent(stack, 'CREATE_IN_PROGRESS', 'User Initiated');
    return { id, stack, template };
  }

  private finalizeCreateStack(stack: InMemoryStack, template: Record<string, any>, disableRollback?: boolean) {
    const { failed, created } = this.createResources(stack, template);
    if (failed) {
      if (disableRollback) {
        this.transitionStack(stack, 'CREATE_FAILED', 'Resource creation failed');
      } else {
        this.transitionStack(stack, 'ROLLBACK_IN_PROGRESS', 'Resource creation failed');
        this.rollbackResources(stack, template, created);
        this.transitionStack(stack, 'ROLLBACK_COMPLETE');
      }
    } else {
      this.transitionStack(stack, 'CREATE_COMPLETE');
    }
  }

  private initCreateChangeSet(input: CreateChangeSetCommandInput): { csId: string; stack: InMemoryStack; cs: InMemoryChangeSet; template: Record<string, any> } {
    const stackName = input.StackName!;
    const csName = input.ChangeSetName!;
    const csType = input.ChangeSetType ?? 'UPDATE';
    const template = parseTemplate(input.TemplateBody);

    let stack: InMemoryStack;
    if (csType === 'CREATE') {
      const existing = this.stacks.get(stackName);
      if (existing && existing.status !== 'DELETE_COMPLETE') {
        cfnError('AlreadyExistsException', `Stack [${stackName}] already exists`);
      }
      const id = stackArn(stackName);
      stack = {
        name: stackName,
        id,
        status: 'REVIEW_IN_PROGRESS',
        template: {},
        parameters: input.Parameters ?? [],
        tags: input.Tags ?? [],
        capabilities: (input.Capabilities as string[]) ?? [],
        outputs: [],
        enableTerminationProtection: false,
        roleArn: input.RoleARN,
        creationTime: new Date(),
        changeSets: [],
        events: [],
      };
      this.stacks.set(stackName, stack);
    } else {
      stack = this.requireStack(stackName);
    }

    if (stack.changeSets.some((c) => c.name === csName)) {
      cfnError('AlreadyExistsException', `ChangeSet [${csName}] already exists`);
    }

    const csId = changeSetArn(stackName, csName);
    const cs: InMemoryChangeSet = {
      name: csName,
      id: csId,
      stackId: stack.id,
      status: 'CREATE_PENDING',
      executionStatus: 'UNAVAILABLE',
      changeSetType: csType,
      template,
      parameters: input.Parameters ?? [],
      tags: input.Tags ?? [],
      capabilities: (input.Capabilities as string[]) ?? [],
      description: input.Description,
      changes: [],
      creationTime: new Date(),
    };
    stack.changeSets.push(cs);
    this.changeSetToStack.set(csId, stack.name);
    return { csId, stack, cs, template };
  }

  private finalizeCreateChangeSet(stack: InMemoryStack, cs: InMemoryChangeSet, template: Record<string, any>) {
    const changes = this.computeChanges(stack.template, template);
    cs.changes = changes;
    if (changes.length === 0) {
      cs.status = 'FAILED';
      cs.statusReason = "The submitted information didn't contain changes.";
      cs.executionStatus = 'UNAVAILABLE';
    } else {
      cs.status = 'CREATE_COMPLETE';
      cs.executionStatus = 'AVAILABLE';
    }
  }

  private requireStack(nameOrId: string): InMemoryStack {
    const stack = this.findStackByNameOrId(nameOrId);
    if (!stack) {
      cfnError('ValidationError', `Stack with id ${nameOrId} does not exist`);
    }
    return stack;
  }

  /**
   * Find a stack by name or by stack ID (ARN).
   * DELETE_COMPLETE stacks can only be found by ID, not by name.
   */
  private findStackByNameOrId(nameOrId: string): InMemoryStack | undefined {
    // Try by name first (only if not deleted)
    const byName = this.stacks.get(nameOrId);
    if (byName && byName.status !== 'DELETE_COMPLETE') {
      return byName;
    }

    // Try by stack ID (ARN) — this also finds deleted stacks
    for (const stack of Array.from(this.stacks.values())) {
      if (stack.id === nameOrId) {
        return stack;
      }
    }

    return undefined;
  }

  private findChangeSet(stack: InMemoryStack, nameOrId: string): InMemoryChangeSet {
    const cs = stack.changeSets.find((c) => c.name === nameOrId || c.id === nameOrId);
    if (!cs) {
      cfnError('ChangeSetNotFoundException', `ChangeSet [${nameOrId}] does not exist`);
    }
    return cs;
  }

  /**
   * Resolve a change set from a ChangeSetName (which may be a name or ARN) and
   * an optional StackName. When StackName is absent, the stack is resolved from
   * the change set ARN via the lookup map.
   */
  private resolveChangeSet(changeSetNameOrArn: string, stackName?: string): { stack: InMemoryStack; changeSet: InMemoryChangeSet } {
    if (stackName) {
      const stack = this.requireStack(stackName);
      return { stack, changeSet: this.findChangeSet(stack, changeSetNameOrArn) };
    }

    // No stack name — try to resolve via the ARN map
    const resolvedStackName = this.changeSetToStack.get(changeSetNameOrArn);
    if (resolvedStackName) {
      const stack = this.requireStack(resolvedStackName);
      return { stack, changeSet: this.findChangeSet(stack, changeSetNameOrArn) };
    }

    // Last resort: linear scan (handles lookup by name without a stack)
    for (const stack of Array.from(this.stacks.values())) {
      const cs = stack.changeSets.find((c) => c.name === changeSetNameOrArn || c.id === changeSetNameOrArn);
      if (cs) {
        return { stack, changeSet: cs };
      }
    }
    cfnError('ChangeSetNotFoundException', `ChangeSet [${changeSetNameOrArn}] does not exist`);
  }

  private requireStableState(stack: InMemoryStack) {
    if (stack.status.endsWith('_IN_PROGRESS')) {
      cfnError('ValidationError', `Stack [${stack.name}] is in ${stack.status} state and can not be updated`);
    }
  }

  /** Check if any resource in the template has Fail: true, or alwaysFailResources is set */
  private shouldFail(template: Record<string, any>): boolean {
    if (this.alwaysFailResources || this.consumeFailFirstDeploy()) return true;
    const resources = templateResources(template);
    return Object.values(resources).some((r: any) => r.Properties?.Fail === true);
  }

  /** Returns true once if failFirstDeploy is set, then clears it */
  private consumeFailFirstDeploy(): boolean {
    if (this.failFirstDeploy) {
      this.failFirstDeploy = false;
      return true;
    }
    return false;
  }

  /** "Create" resources — just generate events for each resource */
  private createResources(stack: InMemoryStack, template: Record<string, any>): { failed: boolean; created: string[] } {
    const created: string[] = [];
    const forceFailAll = this.alwaysFailResources || this.consumeFailFirstDeploy();
    for (const [logicalId, res] of Object.entries(templateResources(template))) {
      const r = res as any;
      if (forceFailAll || r.Properties?.Fail === true) {
        this.addResourceEvent(stack, logicalId, r.Type, 'CREATE_IN_PROGRESS');
        this.addResourceEvent(stack, logicalId, r.Type, 'CREATE_FAILED');
        return { failed: true, created };
      }
      this.addResourceEvent(stack, logicalId, r.Type, 'CREATE_IN_PROGRESS');
      this.addResourceEvent(stack, logicalId, r.Type, 'CREATE_COMPLETE');
      created.push(logicalId);
    }
    return { failed: false, created };
  }

  /** Generate DELETE_COMPLETE events for previously created resources (reverse order) */
  private rollbackResources(stack: InMemoryStack, template: Record<string, any>, logicalIds: string[]) {
    const resources = templateResources(template);
    for (let i = logicalIds.length - 1; i >= 0; i--) {
      const logicalId = logicalIds[i];
      this.addResourceEvent(stack, logicalId, resources[logicalId].Type, 'DELETE_COMPLETE');
    }
  }

  /** Compute the diff between two templates and return Change objects */
  private computeChanges(oldTemplate: Record<string, any>, newTemplate: Record<string, any>): Change[] {
    const oldResources = templateResources(oldTemplate);
    const newResources = templateResources(newTemplate);
    const changes: Change[] = [];

    // Added resources
    for (const logicalId of Object.keys(newResources)) {
      if (!(logicalId in oldResources)) {
        changes.push({
          Type: 'Resource',
          ResourceChange: {
            Action: 'Add',
            LogicalResourceId: logicalId,
            ResourceType: newResources[logicalId].Type,
          },
        });
      }
    }

    // Removed resources
    for (const logicalId of Object.keys(oldResources)) {
      if (!(logicalId in newResources)) {
        changes.push({
          Type: 'Resource',
          ResourceChange: {
            Action: 'Remove',
            LogicalResourceId: logicalId,
            ResourceType: oldResources[logicalId].Type,
          },
        });
      }
    }

    // Modified resources (simple: compare JSON serialization of properties)
    for (const logicalId of Object.keys(newResources)) {
      if (logicalId in oldResources) {
        const oldProps = JSON.stringify(oldResources[logicalId].Properties ?? {});
        const newProps = JSON.stringify(newResources[logicalId].Properties ?? {});
        if (oldProps !== newProps) {
          changes.push({
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: logicalId,
              ResourceType: newResources[logicalId].Type,
              Replacement: 'False',
            },
          });
        }
      }
    }

    return changes;
  }

  private transitionStack(stack: InMemoryStack, status: string, reason?: string) {
    stack.status = status;
    stack.statusReason = reason;
    this.addEvent(stack, status, reason);
  }

  private addEvent(stack: InMemoryStack, status: string, reason?: string) {
    // Events are in reverse chronological order (newest first)
    stack.events.unshift({
      StackId: stack.id,
      StackName: stack.name,
      EventId: uid(),
      LogicalResourceId: stack.name,
      PhysicalResourceId: stack.id,
      ResourceType: 'AWS::CloudFormation::Stack',
      ResourceStatus: status as any,
      ResourceStatusReason: reason,
      Timestamp: new Date(),
    });
  }

  private addResourceEvent(stack: InMemoryStack, logicalId: string, resourceType: string, status: string) {
    stack.events.unshift({
      StackId: stack.id,
      StackName: stack.name,
      EventId: uid(),
      LogicalResourceId: logicalId,
      PhysicalResourceId: `fake-${logicalId}-${uid()}`,
      ResourceType: resourceType,
      ResourceStatus: status as any,
      Timestamp: new Date(),
    });
  }

  private toStackDescription(stack: InMemoryStack): Stack {
    return {
      StackName: stack.name,
      StackId: stack.id,
      StackStatus: stack.status as any,
      StackStatusReason: stack.statusReason,
      CreationTime: stack.creationTime,
      LastUpdatedTime: stack.lastUpdatedTime,
      DeletionTime: stack.deletionTime,
      Parameters: stack.parameters,
      Tags: stack.tags,
      Capabilities: stack.capabilities as any,
      Outputs: stack.outputs.map((o) => ({ OutputKey: o.OutputKey, OutputValue: o.OutputValue })),
      EnableTerminationProtection: stack.enableTerminationProtection,
      RoleARN: stack.roleArn,
    };
  }

  private toStackSummary(stack: InMemoryStack): StackSummary {
    return {
      StackName: stack.name,
      StackId: stack.id,
      StackStatus: stack.status as any,
      CreationTime: stack.creationTime,
      LastUpdatedTime: stack.lastUpdatedTime,
      DeletionTime: stack.deletionTime,
    };
  }

  private scheduleAsync(fn: () => void) {
    setTimeout(fn, this.asyncDelay);
  }
}
