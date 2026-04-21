import { FakeCloudFormation } from './fake-cloudformation';

let fake: FakeCloudFormation;

beforeEach(() => {
  jest.useFakeTimers();
  fake = new FakeCloudFormation();
});

afterEach(() => {
  jest.useRealTimers();
});

test('createChangeSet eventually reaches CREATE_COMPLETE', async () => {
  // GIVEN — a stack exists
  fake.createStackSync({ StackName: 'MyStack' });

  // WHEN — create a change set with a different template
  const result = await fake.createChangeSet({
    StackName: 'MyStack',
    ChangeSetName: 'MyChangeSet',
    TemplateBody: JSON.stringify({ Resources: { Res: { Type: 'Test::Fake::Resource' } } }),
  });

  // THEN — initially in CREATE_PENDING
  const pending = await fake.describeChangeSet({ ChangeSetName: 'MyChangeSet', StackName: 'MyStack' });
  expect(pending.Status).toBe('CREATE_PENDING');

  // Advance timers so the async finalization runs
  await jest.advanceTimersByTimeAsync(50);

  // Now it should be CREATE_COMPLETE
  const complete = await fake.describeChangeSet({ ChangeSetName: 'MyChangeSet', StackName: 'MyStack' });
  expect(complete.Status).toBe('CREATE_COMPLETE');
  expect(complete.ExecutionStatus).toBe('AVAILABLE');
  expect(complete.ChangeSetId).toBe(result.Id);
  expect(complete.Changes!.length).toBeGreaterThan(0);
});
