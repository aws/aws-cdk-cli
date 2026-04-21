Behavioral Model: In-Memory Fake CloudFormation
================================================

This document describes the externally observable behavior of the in-memory fake
CloudFormation implementation. The implementation must match this spec exactly,
but this spec must not include implementation details.

All behavior descriptions are based on the official AWS CloudFormation API
documentation at
https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/.

## Internal State

The fake maintains:

- A map of **stacks** keyed by stack name. Each stack has:
  - `StackName`, `StackId` (an ARN), `StackStatus`, `StackStatusReason`
  - `CreationTime`, `LastUpdatedTime`, `DeletionTime`
  - `Template` (the JSON template body)
  - `Parameters`, `Tags`, `Outputs`, `Capabilities`
  - `EnableTerminationProtection` (boolean, default false)
  - `RoleARN`
  - A list of **change sets**
  - A list of **stack events** (reverse chronological)
- A configurable **page size** for paginated APIs (default 5, for testing)
- A configurable **async delay** (default 20ms) for operations that transition
  through `_IN_PROGRESS` states

## Fake Resource Types

The fake supports one resource type: `Test::Fake::Resource`.

- Properties: `Id` (string, optional), `Fail` (boolean, optional)
- If `Fail` is `true`, the resource "fails" to create/update, causing the stack
  operation to fail.
- Physical resource ID: `fake-<logicalId>-<random>`
- On create/update, the resource simply records its properties. No real side
  effects.

## Stack Status Transitions

Stack operations are **asynchronous**. The API call returns immediately, and the
stack transitions through statuses on a timer (configurable, default 20ms).
Tests that use the fake should use fake timers to advance time.

### CreateStack

1. API returns `{ StackId }` immediately.
2. Stack status: `CREATE_IN_PROGRESS`.
3. After delay, resources are processed in template order:
   - Each resource gets a `CREATE_IN_PROGRESS` then `CREATE_COMPLETE` event.
   - If a resource has `Fail: true`, it gets `CREATE_IN_PROGRESS` then
     `CREATE_FAILED`. Processing stops at the first failure.
4. If all resources succeed → `CREATE_COMPLETE`.
5. If a resource fails:
   - If `DisableRollback` → `CREATE_FAILED`.
   - Otherwise → `ROLLBACK_IN_PROGRESS`. After a further delay, each
     previously-created resource gets a `DELETE_COMPLETE` event (in reverse
     order), then the stack transitions to `ROLLBACK_COMPLETE`.

### UpdateStack

1. Stack must exist and be in a stable state (`*_COMPLETE` or
   `*_FAILED` but not `*_IN_PROGRESS`).
2. If the new template is identical to the current stack template and the
   parameters and tags are unchanged, throws `ValidationError` with message
   `"No updates are to be performed."`.
3. API returns `{ StackId }` immediately.
4. Stack status: `UPDATE_IN_PROGRESS`.
5. After delay:
   - If any resource has `Fail: true` → `UPDATE_FAILED` (if
     `DisableRollback`) or `UPDATE_ROLLBACK_IN_PROGRESS` →
     `UPDATE_ROLLBACK_COMPLETE`.
   - Otherwise → `UPDATE_COMPLETE`.

### DeleteStack

1. If the stack has `EnableTerminationProtection: true`, the API throws a
   `ValidationError`.
2. If the stack doesn't exist, the call is a **no-op** (no error).
3. API returns `{}` immediately.
4. Stack status: `DELETE_IN_PROGRESS`.
5. After delay: `DELETE_COMPLETE`.

### ContinueUpdateRollback

1. Stack must be in `UPDATE_ROLLBACK_FAILED`.
2. Transitions to `UPDATE_ROLLBACK_IN_PROGRESS` → `UPDATE_ROLLBACK_COMPLETE`.

## Change Set Identification

All APIs that accept a `ChangeSetName` parameter also accept a change set ARN
in that field. When a change set ARN is provided, the `StackName` parameter is
optional — the owning stack is resolved from the ARN. When a plain change set
name is provided, `StackName` is required.

This applies to: `DescribeChangeSet`, `ExecuteChangeSet`, `DeleteChangeSet`,
and `GetTemplate` (when the `ChangeSetName` parameter is used).

## Change Set Behavior

### CreateChangeSet

1. If `ChangeSetType` is `CREATE`:
   - A new stack is created in `REVIEW_IN_PROGRESS` status.
   - The change set is associated with this new stack.
2. If `ChangeSetType` is `UPDATE` (or omitted):
   - The stack must already exist.
3. If a change set with the same name already exists on the stack (regardless
   of its status, including `FAILED`), throws `AlreadyExistsException`. The
   existing change set must be deleted first before a new one with the same
   name can be created.
4. The change set is created with status `CREATE_PENDING`.
5. After delay: the change set transitions to `CREATE_IN_PROGRESS`, then
   to `CREATE_COMPLETE` with
   `ExecutionStatus: AVAILABLE`.
   - The `Changes` list is computed by diffing the new template against the
     current stack template. Each added/removed/modified resource logical ID
     produces a `Change` entry with `Action` = `Add`, `Remove`, or `Modify`.
   - If there are no changes, the change set status becomes `FAILED` with
     `StatusReason: "The submitted information didn't contain changes."` and
     `ExecutionStatus: UNAVAILABLE`.
5. Returns `{ Id, StackId }`.

### DescribeChangeSet

1. Returns the change set's current state including `Status`,
   `ExecutionStatus`, `Changes`, `StackId`, `StackName`, `ChangeSetName`,
   `ChangeSetId`, `Parameters`, `Tags`, `Capabilities`, `Description`.
2. If the change set doesn't exist, throws `ChangeSetNotFoundException`.
3. Supports pagination via `NextToken` over the `Changes` list.

### ExecuteChangeSet

1. The change set must have `ExecutionStatus: AVAILABLE`.
2. If not, throws `InvalidChangeSetStatus`.
3. Applies the template from the change set to the stack.
4. The executed change set is **removed** from the stack's change set list
   immediately. Other change sets on the stack are left intact (unlike real
   CloudFormation which deletes them — this simplification avoids interference
   with concurrent operations in tests).
5. Stack transitions:
   - For `ChangeSetType: CREATE`: `CREATE_IN_PROGRESS` → `CREATE_COMPLETE`
     (or failure path).
   - For `ChangeSetType: UPDATE`: `UPDATE_IN_PROGRESS` → `UPDATE_COMPLETE`
     (or failure path).

### DeleteChangeSet

1. If the change set doesn't exist but the stack does, the call is a
   **no-op** (no error).
2. If the change set is in `CREATE_IN_PROGRESS` or `DELETE_IN_PROGRESS`,
   throws `InvalidChangeSetStatus`.
2. Otherwise, removes the change set from the stack.
3. If the stack is in `REVIEW_IN_PROGRESS` and this was the only change set,
   the stack remains in `REVIEW_IN_PROGRESS` (it does NOT get deleted).

## Query APIs

### DescribeStacks

1. If `StackName` is provided:
   - Looks up the stack by name or stack ID (ARN).
   - If the stack doesn't exist, throws `ValidationError` with message
     `"Stack with id <name> does not exist"`.
   - If the stack is in `DELETE_COMPLETE`, it can only be found by stack ID,
     not by name.
   - Returns a single-element `Stacks` array.
2. If `StackName` is omitted:
   - Returns all stacks that are NOT in `DELETE_COMPLETE` status.
   - Paginated.

### ListStacks

1. Returns summary information for all stacks, including deleted ones.
2. If `StackStatusFilter` is provided, only returns stacks matching those
   statuses.
3. Paginated via `NextToken`.

### GetTemplate

1. Returns the `TemplateBody` for the specified stack (as a JSON string).
2. If the stack doesn't exist, throws `ValidationError`.
3. If `ChangeSetName` is provided, returns the template associated with that
   change set instead.

### GetTemplateSummary

1. If `TemplateBody` is provided, parses it and returns parameter declarations
   and resource types.
2. If `StackName` is provided, uses the stack's current template.
3. Returns `Parameters` (list of `ParameterDeclaration`) and `ResourceTypes`.

### DescribeStackEvents

1. Returns stack events in reverse chronological order.
2. Events are generated for:
   - Stack status changes (resource type `AWS::CloudFormation::Stack`)
   - Individual resource create/update/delete operations
3. Paginated via `NextToken`.

### UpdateTerminationProtection

1. Sets `EnableTerminationProtection` on the stack.
2. Returns `{ StackId }`.

## Error Behavior

All errors are thrown as objects with a `name` property matching the AWS error
code (e.g., `"ValidationError"`, `"ChangeSetNotFoundException"`,
`"InvalidChangeSetStatus"`). This matches the AWS SDK v3 error shape.

- `ValidationError`: stack doesn't exist, stack in wrong state, invalid
  parameters
- `ChangeSetNotFoundException`: change set doesn't exist
- `InvalidChangeSetStatus`: change set in wrong state for the operation
- `AlreadyExistsException`: stack already exists (for CreateStack)

## Pagination

All paginated APIs use a page size configurable via `FakeCloudFormationBehaviorOptions.pageSize`
(default 5). The `NextToken` is an opaque string (the index into the result set).

## Test Control

The fake exposes:

- `reset(options?)`: clears all state, optionally reconfigures behavior
- `asyncDelay`: configurable delay for async operations (default 20ms)
- `alwaysFailResources`: when true, all resource operations fail (for testing
  failure paths)
- `failFirstDeploy`: when true, the first deploy fails all resources, then
  auto-clears so subsequent deploys succeed
- `overrideChangeSetChanges`: if set, the next `createChangeSet` call uses
  these changes instead of computing them. Auto-clears after use.
- `overrideChangeSetStatus`: if set, the next `createChangeSet` call uses
  this status/reason/executionStatus. Auto-clears after use.
