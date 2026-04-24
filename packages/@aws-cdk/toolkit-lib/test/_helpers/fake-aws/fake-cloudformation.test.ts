import { FakeCloudFormation } from './fake-cloudformation';

const TEMPLATE_WITH_RESOURCE = JSON.stringify({
  Resources: { Res: { Type: 'Test::Fake::Resource' } },
});

const TEMPLATE_WITH_TWO_RESOURCES = JSON.stringify({
  Resources: {
    First: { Type: 'Test::Fake::Resource' },
    Second: { Type: 'Test::Fake::Resource' },
  },
});

const TEMPLATE_WITH_FAILING_RESOURCE = JSON.stringify({
  Resources: {
    Good: { Type: 'Test::Fake::Resource' },
    Bad: { Type: 'Test::Fake::Resource', Properties: { Fail: true } },
  },
});

let fake: FakeCloudFormation;

beforeEach(() => {
  jest.useFakeTimers();
  fake = new FakeCloudFormation();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Advance fake timers until all async operations complete */
async function flush() {
  await jest.advanceTimersByTimeAsync(100);
}

/** Create a stack synchronously and advance timers so it reaches final state */
async function createStack(name: string, template = TEMPLATE_WITH_RESOURCE) {
  const result = await fake.createStack({ StackName: name, TemplateBody: template });
  await flush();
  return result;
}

// =========================================================================
// CreateStack
// =========================================================================

describe('CreateStack', () => {
  test('returns StackId immediately', async () => {
    const result = await fake.createStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_RESOURCE });
    expect(result.StackId).toContain('arn:aws:cloudformation');
  });

  test('stack is CREATE_IN_PROGRESS before timer fires', async () => {
    await fake.createStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_RESOURCE });
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('CREATE_IN_PROGRESS');
  });

  test('stack reaches CREATE_COMPLETE after timer', async () => {
    await createStack('S');
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('CREATE_COMPLETE');
  });

  test('generates per-resource events on success', async () => {
    await createStack('S', TEMPLATE_WITH_TWO_RESOURCES);
    const events = await fake.describeStackEvents({ StackName: 'S' });
    const resourceEvents = events.StackEvents!.filter(e => e.ResourceType !== 'AWS::CloudFormation::Stack');
    // Two resources × 2 events each (CREATE_IN_PROGRESS + CREATE_COMPLETE)
    expect(resourceEvents.length).toBe(4);
  });

  test('failing resource causes ROLLBACK_COMPLETE with rollback events', async () => {
    await createStack('S', TEMPLATE_WITH_FAILING_RESOURCE);
    const desc = await fake.describeStacks({ StackName: 'S' });
    // Good succeeds, Bad fails → rollback
    expect(desc.Stacks![0].StackStatus).toBe('ROLLBACK_COMPLETE');

    const events = await fake.describeStackEvents({ StackName: 'S' });
    const deleteEvents = events.StackEvents!.filter(
      e => e.ResourceType !== 'AWS::CloudFormation::Stack' && e.ResourceStatus === 'DELETE_COMPLETE',
    );
    // The successfully created 'Good' resource should be rolled back
    expect(deleteEvents.length).toBe(1);
    expect(deleteEvents[0].LogicalResourceId).toBe('Good');
  });

  test('failing resource with DisableRollback causes CREATE_FAILED', async () => {
    await fake.createStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_FAILING_RESOURCE, DisableRollback: true });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('CREATE_FAILED');
  });

  test('throws AlreadyExistsException if stack exists', async () => {
    await createStack('S');
    await expect(fake.createStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_RESOURCE }))
      .rejects.toThrow(/already exists/);
  });

  test('can recreate a DELETE_COMPLETE stack', async () => {
    await createStack('S');
    await fake.deleteStack({ StackName: 'S' });
    await flush();
    await createStack('S');
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('CREATE_COMPLETE');
  });
});

// =========================================================================
// UpdateStack
// =========================================================================

describe('UpdateStack', () => {
  test('updates stack to UPDATE_COMPLETE', async () => {
    await createStack('S');
    await fake.updateStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_TWO_RESOURCES });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('UPDATE_COMPLETE');
  });

  test('throws ValidationError if stack does not exist', async () => {
    await expect(fake.updateStack({ StackName: 'Nope', TemplateBody: TEMPLATE_WITH_RESOURCE }))
      .rejects.toThrow(/does not exist/);
  });

  test('throws ValidationError if stack is in progress', async () => {
    await fake.createStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_RESOURCE });
    // Don't flush — stack is still CREATE_IN_PROGRESS
    await expect(fake.updateStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_TWO_RESOURCES }))
      .rejects.toThrow(/IN_PROGRESS/);
  });

  test('throws ValidationError if template and params unchanged', async () => {
    await createStack('S');
    await expect(fake.updateStack({ StackName: 'S' }))
      .rejects.toThrow(/No updates are to be performed/);
  });

  test('proceeds if parameters differ even with same template', async () => {
    await createStack('S');
    await fake.updateStack({
      StackName: 'S',
      Parameters: [{ ParameterKey: 'P', ParameterValue: 'V' }],
    });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('UPDATE_COMPLETE');
  });

  test('failing resource with rollback reaches UPDATE_ROLLBACK_COMPLETE', async () => {
    await createStack('S');
    await fake.updateStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_FAILING_RESOURCE });
    await flush(); // UPDATE_ROLLBACK_IN_PROGRESS
    await flush(); // UPDATE_ROLLBACK_COMPLETE
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('UPDATE_ROLLBACK_COMPLETE');
  });

  test('failing resource with DisableRollback reaches UPDATE_FAILED', async () => {
    await createStack('S');
    await fake.updateStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_FAILING_RESOURCE, DisableRollback: true });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('UPDATE_FAILED');
  });
});

// =========================================================================
// DeleteStack
// =========================================================================

describe('DeleteStack', () => {
  test('transitions to DELETE_COMPLETE', async () => {
    await createStack('S');
    await fake.deleteStack({ StackName: 'S' });
    await flush();
    // DELETE_COMPLETE stacks are not returned by describeStacks by name
    await expect(fake.describeStacks({ StackName: 'S' })).rejects.toThrow(/does not exist/);
  });

  test('is a no-op if stack does not exist', async () => {
    // Should not throw
    await fake.deleteStack({ StackName: 'Nope' });
  });

  test('is a no-op if stack is already DELETE_COMPLETE', async () => {
    await createStack('S');
    await fake.deleteStack({ StackName: 'S' });
    await flush();
    // Second delete should not throw
    const stackId = (await fake.listStacks({})).StackSummaries![0].StackId!;
    await fake.deleteStack({ StackName: stackId });
  });

  test('throws ValidationError if termination protection is enabled', async () => {
    await createStack('S');
    await fake.updateTerminationProtection({ StackName: 'S', EnableTerminationProtection: true });
    await expect(fake.deleteStack({ StackName: 'S' })).rejects.toThrow(/TerminationProtection/);
  });
});

// =========================================================================
// ContinueUpdateRollback
// =========================================================================

describe('ContinueUpdateRollback', () => {
  test('transitions from UPDATE_ROLLBACK_FAILED to UPDATE_ROLLBACK_COMPLETE', async () => {
    fake.createStackSync({ StackName: 'S', StackStatus: 'UPDATE_ROLLBACK_FAILED' });
    await fake.continueUpdateRollback({ StackName: 'S' });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('UPDATE_ROLLBACK_COMPLETE');
  });

  test('throws if stack is not in UPDATE_ROLLBACK_FAILED', async () => {
    await createStack('S');
    await expect(fake.continueUpdateRollback({ StackName: 'S' })).rejects.toThrow(/can not be continued/);
  });
});

// =========================================================================
// CreateChangeSet
// =========================================================================

describe('CreateChangeSet', () => {
  test('CREATE type creates stack in REVIEW_IN_PROGRESS', async () => {
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS',
      ChangeSetType: 'CREATE',
      TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('REVIEW_IN_PROGRESS');
  });

  test('UPDATE type requires existing stack', async () => {
    await expect(fake.createChangeSet({
      StackName: 'Nope',
      ChangeSetName: 'CS',
      ChangeSetType: 'UPDATE',
      TemplateBody: TEMPLATE_WITH_RESOURCE,
    })).rejects.toThrow(/does not exist/);
  });

  test('starts in CREATE_PENDING, transitions through CREATE_IN_PROGRESS to CREATE_COMPLETE', async () => {
    fake.createStackSync({ StackName: 'S' });
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS',
      TemplateBody: TEMPLATE_WITH_RESOURCE,
    });

    const pending = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    expect(pending.Status).toBe('CREATE_PENDING');

    await flush();

    const complete = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    expect(complete.Status).toBe('CREATE_COMPLETE');
    expect(complete.ExecutionStatus).toBe('AVAILABLE');
  });

  test('computes Add/Remove/Modify changes', async () => {
    fake.createStackSync({ StackName: 'S' });
    fake.firstStack().template = {
      Resources: {
        Keep: { Type: 'Test::Fake::Resource', Properties: { Id: 'old' } },
        Remove: { Type: 'Test::Fake::Resource' },
      },
    };
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS',
      TemplateBody: JSON.stringify({
        Resources: {
          Keep: { Type: 'Test::Fake::Resource', Properties: { Id: 'new' } },
          Added: { Type: 'Test::Fake::Resource' },
        },
      }),
    });
    await flush();

    const cs = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    const actions = cs.Changes!.map(c => `${c.ResourceChange!.Action}:${c.ResourceChange!.LogicalResourceId}`).sort();
    expect(actions).toEqual(['Add:Added', 'Modify:Keep', 'Remove:Remove']);
  });

  test('no-changes change set ends in FAILED', async () => {
    fake.createStackSync({ StackName: 'S' });
    fake.firstStack().template = { Resources: { R: { Type: 'T' } } };
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS',
      TemplateBody: JSON.stringify({ Resources: { R: { Type: 'T' } } }),
    });
    await flush();

    const cs = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    expect(cs.Status).toBe('FAILED');
    expect(cs.StatusReason).toContain("didn't contain changes");
    expect(cs.ExecutionStatus).toBe('UNAVAILABLE');
  });

  test('throws AlreadyExistsException for duplicate change set name', async () => {
    fake.createStackSync({ StackName: 'S' });
    await fake.createChangeSet({ StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE });
    await expect(fake.createChangeSet({ StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE }))
      .rejects.toThrow(/already exists/);
  });

  test('CREATE type on REVIEW_IN_PROGRESS stack reuses the stack', async () => {
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS1',
      ChangeSetType: 'CREATE',
      TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    // Second CREATE change set on same REVIEW_IN_PROGRESS stack should work
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS2',
      ChangeSetType: 'CREATE',
      TemplateBody: TEMPLATE_WITH_TWO_RESOURCES,
    });
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('REVIEW_IN_PROGRESS');
  });
});

// =========================================================================
// DescribeChangeSet
// =========================================================================

describe('DescribeChangeSet', () => {
  test('throws ChangeSetNotFoundException if not found', async () => {
    fake.createStackSync({ StackName: 'S' });
    await expect(fake.describeChangeSet({ ChangeSetName: 'Nope', StackName: 'S' }))
      .rejects.toThrow(/does not exist/);
  });

  test('can resolve change set by ARN without StackName', async () => {
    fake.createStackSync({ StackName: 'S' });
    const { Id } = await fake.createChangeSet({
      StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    await flush();
    const desc = await fake.describeChangeSet({ ChangeSetName: Id! });
    expect(desc.ChangeSetName).toBe('CS');
    expect(desc.StackName).toBe('S');
  });
});

// =========================================================================
// ExecuteChangeSet
// =========================================================================

describe('ExecuteChangeSet', () => {
  test('applies template and transitions to CREATE_COMPLETE for CREATE type', async () => {
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS',
      ChangeSetType: 'CREATE',
      TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    await flush();
    await fake.executeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('CREATE_COMPLETE');
    // Template should be applied
    const tpl = await fake.getTemplate({ StackName: 'S' });
    expect(JSON.parse(tpl.TemplateBody!)).toHaveProperty('Resources.Res');
  });

  test('transitions to UPDATE_COMPLETE for UPDATE type', async () => {
    await createStack('S');
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS',
      TemplateBody: TEMPLATE_WITH_TWO_RESOURCES,
    });
    await flush();
    await fake.executeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('UPDATE_COMPLETE');
  });

  test('throws InvalidChangeSetStatus if not AVAILABLE', async () => {
    fake.createStackSync({ StackName: 'S' });
    await fake.createChangeSet({
      StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    // Don't flush — change set is still CREATE_PENDING
    await expect(fake.executeChangeSet({ ChangeSetName: 'CS', StackName: 'S' }))
      .rejects.toThrow(/cannot be executed/);
  });

  test('removes executed change set from stack', async () => {
    fake.createStackSync({ StackName: 'S' });
    await fake.createChangeSet({
      StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    await flush();
    await fake.executeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    // Change set should no longer be findable
    await expect(fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' }))
      .rejects.toThrow(/does not exist/);
  });

  test('can resolve by ARN without StackName', async () => {
    fake.createStackSync({ StackName: 'S' });
    const { Id } = await fake.createChangeSet({
      StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    await flush();
    await fake.executeChangeSet({ ChangeSetName: Id! });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('UPDATE_COMPLETE');
  });
});

// =========================================================================
// DeleteChangeSet
// =========================================================================

describe('DeleteChangeSet', () => {
  test('removes change set from stack', async () => {
    fake.createStackSync({ StackName: 'S' });
    await fake.createChangeSet({
      StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    await flush();
    await fake.deleteChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    await expect(fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' }))
      .rejects.toThrow(/does not exist/);
  });

  test('is a no-op if change set does not exist but stack does', async () => {
    fake.createStackSync({ StackName: 'S' });
    // Should not throw
    await fake.deleteChangeSet({ ChangeSetName: 'Nope', StackName: 'S' });
  });

  test('REVIEW_IN_PROGRESS stack remains after deleting its only change set', async () => {
    await fake.createChangeSet({
      StackName: 'S',
      ChangeSetName: 'CS',
      ChangeSetType: 'CREATE',
      TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    await flush();
    await fake.deleteChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('REVIEW_IN_PROGRESS');
  });
});

// =========================================================================
// DescribeStacks
// =========================================================================

describe('DescribeStacks', () => {
  test('throws ValidationError for non-existent stack', async () => {
    await expect(fake.describeStacks({ StackName: 'Nope' })).rejects.toThrow(/does not exist/);
  });

  test('returns stack by name', async () => {
    await createStack('S');
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks!.length).toBe(1);
    expect(desc.Stacks![0].StackName).toBe('S');
  });

  test('returns stack by stack ID (ARN)', async () => {
    const { StackId } = await createStack('S');
    const desc = await fake.describeStacks({ StackName: StackId! });
    expect(desc.Stacks![0].StackName).toBe('S');
  });

  test('DELETE_COMPLETE stack is only findable by ARN', async () => {
    const { StackId } = await createStack('S');
    await fake.deleteStack({ StackName: 'S' });
    await flush();
    await expect(fake.describeStacks({ StackName: 'S' })).rejects.toThrow(/does not exist/);
    const desc = await fake.describeStacks({ StackName: StackId! });
    expect(desc.Stacks![0].StackStatus).toBe('DELETE_COMPLETE');
  });

  test('without StackName returns all non-deleted stacks', async () => {
    await createStack('A');
    await createStack('B');
    await createStack('C');
    await fake.deleteStack({ StackName: 'B' });
    await flush();
    const desc = await fake.describeStacks({});
    expect(desc.Stacks!.map(s => s.StackName).sort()).toEqual(['A', 'C']);
  });
});

// =========================================================================
// ListStacks
// =========================================================================

describe('ListStacks', () => {
  test('returns all stacks including deleted', async () => {
    await createStack('A');
    await createStack('B');
    await fake.deleteStack({ StackName: 'A' });
    await flush();
    const list = await fake.listStacks({});
    expect(list.StackSummaries!.length).toBe(2);
  });

  test('filters by StackStatusFilter', async () => {
    await createStack('A');
    await createStack('B');
    await fake.deleteStack({ StackName: 'A' });
    await flush();
    const list = await fake.listStacks({ StackStatusFilter: ['DELETE_COMPLETE'] });
    expect(list.StackSummaries!.length).toBe(1);
    expect(list.StackSummaries![0].StackName).toBe('A');
  });
});

// =========================================================================
// GetTemplate
// =========================================================================

describe('GetTemplate', () => {
  test('returns stack template as JSON string', async () => {
    await createStack('S', TEMPLATE_WITH_RESOURCE);
    const tpl = await fake.getTemplate({ StackName: 'S' });
    expect(JSON.parse(tpl.TemplateBody!)).toHaveProperty('Resources.Res');
  });

  test('throws if stack does not exist', async () => {
    await expect(fake.getTemplate({ StackName: 'Nope' })).rejects.toThrow(/does not exist/);
  });

  test('returns change set template when ChangeSetName is provided', async () => {
    fake.createStackSync({ StackName: 'S' });
    await fake.createChangeSet({
      StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_TWO_RESOURCES,
    });
    await flush();
    const tpl = await fake.getTemplate({ StackName: 'S', ChangeSetName: 'CS' });
    const parsed = JSON.parse(tpl.TemplateBody!);
    expect(Object.keys(parsed.Resources)).toEqual(['First', 'Second']);
  });

  test('resolves change set by ARN without StackName', async () => {
    fake.createStackSync({ StackName: 'S' });
    const { Id } = await fake.createChangeSet({
      StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE,
    });
    const tpl = await fake.getTemplate({ ChangeSetName: Id! });
    expect(JSON.parse(tpl.TemplateBody!)).toHaveProperty('Resources.Res');
  });
});

// =========================================================================
// GetTemplateSummary
// =========================================================================

describe('GetTemplateSummary', () => {
  test('returns parameters and resource types from TemplateBody', async () => {
    const summary = await fake.getTemplateSummary({
      TemplateBody: JSON.stringify({
        Parameters: { P: { Type: 'String', Default: 'x' } },
        Resources: { R: { Type: 'AWS::S3::Bucket' } },
      }),
    });
    expect(summary.Parameters![0].ParameterKey).toBe('P');
    expect(summary.ResourceTypes).toEqual(['AWS::S3::Bucket']);
  });

  test('uses stack template when StackName is provided', async () => {
    await createStack('S', TEMPLATE_WITH_RESOURCE);
    const summary = await fake.getTemplateSummary({ StackName: 'S' });
    expect(summary.ResourceTypes).toEqual(['Test::Fake::Resource']);
  });
});

// =========================================================================
// DescribeStackEvents
// =========================================================================

describe('DescribeStackEvents', () => {
  test('returns events in reverse chronological order', async () => {
    await createStack('S');
    const events = await fake.describeStackEvents({ StackName: 'S' });
    // Last event should be CREATE_COMPLETE (most recent)
    expect(events.StackEvents![0].ResourceStatus).toBe('CREATE_COMPLETE');
    // First event (oldest) should be CREATE_IN_PROGRESS
    const last = events.StackEvents![events.StackEvents!.length - 1];
    expect(last.ResourceStatus).toBe('CREATE_IN_PROGRESS');
  });

  test('includes stack-level and resource-level events', async () => {
    await createStack('S', TEMPLATE_WITH_RESOURCE);
    const events = await fake.describeStackEvents({ StackName: 'S' });
    const types = new Set(events.StackEvents!.map(e => e.ResourceType));
    expect(types).toContain('AWS::CloudFormation::Stack');
    expect(types).toContain('Test::Fake::Resource');
  });
});

// =========================================================================
// UpdateTerminationProtection
// =========================================================================

describe('UpdateTerminationProtection', () => {
  test('sets and returns StackId', async () => {
    const { StackId } = await createStack('S');
    const result = await fake.updateTerminationProtection({ StackName: 'S', EnableTerminationProtection: true });
    expect(result.StackId).toBe(StackId);
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].EnableTerminationProtection).toBe(true);
  });
});

// =========================================================================
// Pagination
// =========================================================================

describe('Pagination', () => {
  test('DescribeStacks paginates', async () => {
    fake.reset({ pageSize: 2 });
    for (let i = 0; i < 5; i++) await createStack(`S${i}`);

    const page1 = await fake.describeStacks({});
    expect(page1.Stacks!.length).toBe(2);
    expect(page1.NextToken).toBeDefined();

    const page2 = await fake.describeStacks({ NextToken: page1.NextToken });
    expect(page2.Stacks!.length).toBe(2);

    const page3 = await fake.describeStacks({ NextToken: page2.NextToken });
    expect(page3.Stacks!.length).toBe(1);
    expect(page3.NextToken).toBeUndefined();
  });

  test('ListStacks paginates', async () => {
    fake.reset({ pageSize: 2 });
    for (let i = 0; i < 3; i++) await createStack(`S${i}`);

    const page1 = await fake.listStacks({});
    expect(page1.StackSummaries!.length).toBe(2);
    expect(page1.NextToken).toBeDefined();

    const page2 = await fake.listStacks({ NextToken: page1.NextToken });
    expect(page2.StackSummaries!.length).toBe(1);
    expect(page2.NextToken).toBeUndefined();
  });

  test('DescribeStackEvents paginates', async () => {
    fake.reset({ pageSize: 2 });
    await createStack('S', TEMPLATE_WITH_TWO_RESOURCES);

    const page1 = await fake.describeStackEvents({ StackName: 'S' });
    expect(page1.StackEvents!.length).toBe(2);
    expect(page1.NextToken).toBeDefined();
  });

  test('DescribeChangeSet paginates over Changes', async () => {
    fake.reset({ pageSize: 1 });
    fake.createStackSync({ StackName: 'S' });
    await fake.createChangeSet({
      StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_TWO_RESOURCES,
    });
    await flush();

    const page1 = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    expect(page1.Changes!.length).toBe(1);
    expect(page1.NextToken).toBeDefined();

    const page2 = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S', NextToken: page1.NextToken });
    expect(page2.Changes!.length).toBe(1);
    expect(page2.NextToken).toBeUndefined();
  });
});

// =========================================================================
// Error behavior
// =========================================================================

describe('Error behavior', () => {
  test('errors have .name matching AWS error code', async () => {
    await expect(fake.describeStacks({ StackName: 'Nope' })).rejects.toMatchObject({ name: 'ValidationError' });
  });

  test('ChangeSetNotFoundException has correct name', async () => {
    fake.createStackSync({ StackName: 'S' });
    await expect(fake.describeChangeSet({ ChangeSetName: 'Nope', StackName: 'S' })).rejects.toMatchObject({ name: 'ChangeSetNotFoundException' });
  });

  test('AlreadyExistsException has correct name', async () => {
    await createStack('S');
    await expect(fake.createStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_RESOURCE })).rejects.toMatchObject({ name: 'AlreadyExistsException' });
  });
});

// =========================================================================
// Test control
// =========================================================================

describe('Test control', () => {
  test('reset clears all state', async () => {
    await createStack('S');
    fake.reset();
    await expect(fake.describeStacks({ StackName: 'S' })).rejects.toThrow(/does not exist/);
  });

  test('alwaysFailResources causes all deploys to fail', async () => {
    fake.reset({ alwaysFailResources: true });
    await fake.createStack({ StackName: 'S', TemplateBody: TEMPLATE_WITH_RESOURCE });
    await flush();
    const desc = await fake.describeStacks({ StackName: 'S' });
    expect(desc.Stacks![0].StackStatus).toBe('ROLLBACK_COMPLETE');
  });

  test('failFirstDeploy fails first deploy then auto-clears', async () => {
    fake.reset({ failFirstDeploy: true });
    await fake.createStack({ StackName: 'S1', TemplateBody: TEMPLATE_WITH_RESOURCE });
    await flush();
    const first = await fake.describeStacks({ StackName: 'S1' });
    expect(first.Stacks![0].StackStatus).toBe('ROLLBACK_COMPLETE');

    // Second deploy should succeed
    await fake.createStack({ StackName: 'S2', TemplateBody: TEMPLATE_WITH_RESOURCE });
    await flush();
    const second = await fake.describeStacks({ StackName: 'S2' });
    expect(second.Stacks![0].StackStatus).toBe('CREATE_COMPLETE');
  });

  test('overrideChangeSetChanges overrides computed changes', async () => {
    fake.createStackSync({ StackName: 'S' });
    fake.overrideChangeSetChanges = [
      { Type: 'Resource', ResourceChange: { Action: 'Add', LogicalResourceId: 'Custom' } },
    ];
    await fake.createChangeSet({ StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE });
    await flush();
    const cs = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    expect(cs.Changes!.length).toBe(1);
    expect(cs.Changes![0].ResourceChange!.LogicalResourceId).toBe('Custom');
    // Auto-cleared
    expect(fake.overrideChangeSetChanges).toBeUndefined();
  });

  test('overrideChangeSetChanges=[] forces FAILED status', async () => {
    fake.createStackSync({ StackName: 'S' });
    fake.overrideChangeSetChanges = [];
    await fake.createChangeSet({ StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE });
    await flush();
    const cs = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    expect(cs.Status).toBe('FAILED');
  });

  test('overrideChangeSetStatus overrides entire status', async () => {
    fake.createStackSync({ StackName: 'S' });
    fake.overrideChangeSetStatus = { status: 'FAILED', statusReason: 'Custom reason', executionStatus: 'UNAVAILABLE' };
    await fake.createChangeSet({ StackName: 'S', ChangeSetName: 'CS', TemplateBody: TEMPLATE_WITH_RESOURCE });
    await flush();
    const cs = await fake.describeChangeSet({ ChangeSetName: 'CS', StackName: 'S' });
    expect(cs.Status).toBe('FAILED');
    expect(cs.StatusReason).toBe('Custom reason');
    expect(fake.overrideChangeSetStatus).toBeUndefined();
  });
});
