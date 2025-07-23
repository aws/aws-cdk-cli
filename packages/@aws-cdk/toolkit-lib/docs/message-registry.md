---
title: Messages and payloads
group: Documents
---
# Messages and payloads

The CDK Toolkit emits *messages* and *requests* to structure interactions.
A *request* is a special *message* that allows the receiver to respond, if no response is returned the toolkit will continue with a default.
Messages are unidirectional and always send from the CDK Toolkit to your integration.

All messages include text that is suitable for display to an end-user or logging.
Some messages also include a unique `code` and a additional payload `data`, providing you with structured information for your integration.
*Requests* always have a `code` and can be addressed explicitly.
See {@link IoMessage} and {@link IoRequest} for a complete list of available fields.

## Levels

Messages have a `level` assigned to them.
Levels are ordered by their importance, with `error` being the most and `trace` being the least important.

| Level      | Description                                    |
| ---------- | ---------------------------------------------- |
| `error`  | Error messages that may affect operation.      |
| `result` | Primary message of an operation.               |
| `warn`   | Warning messages that don't prevent operation. |
| `info`   | General informational messages.                |
| `debug`  | Detailed messages for troubleshooting.         |
| `trace`  | Very detailed execution flow information.      |

Attached levels are an informal recommendation of what *we* believe is the relevance of a specific message.
Your integration will always receive all messages of all levels.
It is up to you to filter out irrelevant messages.
For standard operations, we recommend to display all messages with level `info` or above.

## Backwards compatibility

Messages and requests are an essential part of the CDK Toolkit's public contract.
We recognize integrators will build critical workflows depending on these structured interactions.
To help integrators build with confidence, we provide clear expectations with regards to backwards compatibility of messages.

**Depend only on messages and requests with a `code`. Treat all other messages as informational only.**
If a message does not have a code, it can change or disappear at any time without notice.

**Only the `code` and `data` properties of a message are in scope for backwards compatibility.**
Payload data can change, but we will only make type-compatible, additive changes.
For example we may add new data, but will not remove information.

For the avoidance of doubt, the following changes are explicitly not considered breaking:

- a change to the message text or level,
- a change to the default response of a request,
- a change to the order messages and requests are emitted in,
- the addition of new messages and requests, and
- the removal of messages without a code

## Registry

This is the complete list of all currently available messages with codes and their respective payload interface.
We are welcoming requests for additional coded messages and data.
Please let us know by [opening an issue](https://github.com/aws/aws-cdk-cli/issues/new/choose).

| Code | Description | Level | Payload data interface |
|------|-------------|-------|------------------------|
| `CDK_TOOLKIT_W0100` | Credential plugin warnings | `warn` | n/a |
| `CDK_TOOLKIT_I1000` | Provides synthesis times. | `info` | {@link Duration} |
| `CDK_TOOLKIT_I1001` | Cloud Assembly synthesis is starting | `trace` | {@link StackSelectionDetails} |
| `CDK_TOOLKIT_I1901` | Provides stack data | `result` | {@link StackAndAssemblyData} |
| `CDK_TOOLKIT_I1902` | Successfully deployed stacks | `result` | {@link AssemblyData} |
| `CDK_TOOLKIT_I2901` | Provides details on the selected stacks and their dependencies | `result` | {@link StackDetailsPayload} |
| `CDK_TOOLKIT_I3100` | Confirm the import of a specific resource | `info` | {@link ResourceImportRequest} |
| `CDK_TOOLKIT_I3110` | Additional information is needed to identify a resource | `info` | {@link ResourceIdentificationRequest} |
| `CDK_TOOLKIT_E3900` | Resource import failed | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_I4000` | Diff stacks is starting | `trace` | {@link StackSelectionDetails} |
| `CDK_TOOLKIT_I4001` | Output of the diff command | `result` | {@link DiffResult} |
| `CDK_TOOLKIT_I4002` | The diff for a single stack | `result` | {@link StackDiff} |
| `CDK_TOOLKIT_I4500` | Drift detection is starting | `trace` | {@link StackSelectionDetails} |
| `CDK_TOOLKIT_I4592` | Results of the drift | `result` | {@link Duration} |
| `CDK_TOOLKIT_I4590` | Results of a stack drift | `result` | {@link DriftResultPayload} |
| `CDK_TOOLKIT_W4591` | Missing drift result fort a stack. | `warn` | {@link SingleStack} |
| `CDK_TOOLKIT_I5000` | Provides deployment times | `info` | {@link Duration} |
| `CDK_TOOLKIT_I5001` | Provides total time in deploy action, including synth and rollback | `info` | {@link Duration} |
| `CDK_TOOLKIT_I5002` | Provides time for resource migration | `info` | {@link Duration} |
| `CDK_TOOLKIT_W5021` | Empty non-existent stack, deployment is skipped | `warn` | n/a |
| `CDK_TOOLKIT_W5022` | Empty existing stack, stack will be destroyed | `warn` | n/a |
| `CDK_TOOLKIT_I5031` | Informs about any log groups that are traced as part of the deployment | `info` | n/a |
| `CDK_TOOLKIT_I5032` | Start monitoring log groups | `debug` | {@link CloudWatchLogMonitorControlEvent} |
| `CDK_TOOLKIT_I5033` | A log event received from Cloud Watch | `info` | {@link CloudWatchLogEvent} |
| `CDK_TOOLKIT_I5034` | Stop monitoring log groups | `debug` | {@link CloudWatchLogMonitorControlEvent} |
| `CDK_TOOLKIT_E5035` | A log monitoring error | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_I5050` | Confirm rollback during deployment | `info` | {@link ConfirmationRequest} |
| `CDK_TOOLKIT_I5060` | Confirm deploy security sensitive changes | `info` | {@link DeployConfirmationRequest} |
| `CDK_TOOLKIT_I5100` | Stack deploy progress | `info` | {@link StackDeployProgress} |
| `CDK_TOOLKIT_I5210` | Started building a specific asset | `trace` | {@link BuildAsset} |
| `CDK_TOOLKIT_I5211` | Building the asset has completed | `trace` | {@link Duration} |
| `CDK_TOOLKIT_I5220` | Started publishing a specific asset | `trace` | {@link PublishAsset} |
| `CDK_TOOLKIT_I5221` | Publishing the asset has completed | `trace` | {@link Duration} |
| `CDK_TOOLKIT_I5310` | The computed settings used for file watching | `debug` | {@link WatchSettings} |
| `CDK_TOOLKIT_I5311` | File watching started | `info` | {@link FileWatchEvent} |
| `CDK_TOOLKIT_I5312` | File event detected, starting deployment | `info` | {@link FileWatchEvent} |
| `CDK_TOOLKIT_I5313` | File event detected during active deployment, changes are queued | `info` | {@link FileWatchEvent} |
| `CDK_TOOLKIT_I5314` | Initial watch deployment started | `info` | n/a |
| `CDK_TOOLKIT_I5315` | Queued watch deployment started | `info` | n/a |
| `CDK_TOOLKIT_I5400` | Attempting a hotswap deployment | `trace` | {@link HotswapDeploymentAttempt} |
| `CDK_TOOLKIT_I5401` | Computed details for the hotswap deployment | `trace` | {@link HotswapDeploymentDetails} |
| `CDK_TOOLKIT_I5402` | A hotswappable change is processed as part of a hotswap deployment | `info` | {@link HotswappableChange} |
| `CDK_TOOLKIT_I5403` | The hotswappable change has completed processing | `info` | {@link HotswappableChange} |
| `CDK_TOOLKIT_I5410` | Hotswap deployment has ended, a full deployment might still follow if needed | `info` | {@link HotswapResult} |
| `CDK_TOOLKIT_I5501` | Stack Monitoring: Start monitoring of a single stack | `info` | {@link StackMonitoringControlEvent} |
| `CDK_TOOLKIT_I5502` | Stack Monitoring: Activity event for a single stack | `info` | {@link StackActivity} |
| `CDK_TOOLKIT_I5503` | Stack Monitoring: Finished monitoring of a single stack | `info` | {@link StackMonitoringControlEvent} |
| `CDK_TOOLKIT_I5900` | Deployment results on success | `result` | {@link SuccessfulDeployStackResult} |
| `CDK_TOOLKIT_I5901` | Generic deployment success messages | `info` | n/a |
| `CDK_TOOLKIT_W5400` | Hotswap disclosure message | `warn` | n/a |
| `CDK_TOOLKIT_E5001` | No stacks found | `error` | n/a |
| `CDK_TOOLKIT_E5500` | Stack Monitoring error | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_I6000` | Provides rollback times | `info` | {@link Duration} |
| `CDK_TOOLKIT_I6100` | Stack rollback progress | `info` | {@link StackRollbackProgress} |
| `CDK_TOOLKIT_E6001` | No stacks found | `error` | n/a |
| `CDK_TOOLKIT_E6900` | Rollback failed | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_I7000` | Provides destroy times | `info` | {@link Duration} |
| `CDK_TOOLKIT_I7001` | Provides destroy time for a single stack | `trace` | {@link Duration} |
| `CDK_TOOLKIT_I7010` | Confirm destroy stacks | `info` | {@link ConfirmationRequest} |
| `CDK_TOOLKIT_I7100` | Stack destroy progress | `info` | {@link StackDestroyProgress} |
| `CDK_TOOLKIT_I7101` | Start stack destroying | `trace` | {@link StackDestroy} |
| `CDK_TOOLKIT_I7900` | Stack deletion succeeded | `result` | [cxapi.CloudFormationStackArtifact](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.CloudFormationStackArtifact.html) |
| `CDK_TOOLKIT_E7010` | Action was aborted due to negative confirmation of request | `error` | n/a |
| `CDK_TOOLKIT_E7900` | Stack deletion failed | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_E8900` | Stack refactor failed | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_I8900` | Refactor result | `result` | {@link RefactorResult} |
| `CDK_TOOLKIT_W8010` | Refactor execution not yet supported | `warn` | n/a |
| `CDK_TOOLKIT_I9000` | Provides bootstrap times | `info` | {@link Duration} |
| `CDK_TOOLKIT_I9100` | Bootstrap progress | `info` | {@link BootstrapEnvironmentProgress} |
| `CDK_TOOLKIT_I9210` | Confirm the deletion of a batch of assets | `info` | {@link AssetBatchDeletionRequest} |
| `CDK_TOOLKIT_I9900` | Bootstrap results on success | `result` | [cxapi.Environment](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.Environment.html) |
| `CDK_TOOLKIT_E9900` | Bootstrap failed | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_I0100` | Notices decoration (the header or footer of a list of notices) | `info` | n/a |
| `CDK_TOOLKIT_W0101` | A notice that is marked as a warning | `warn` | n/a |
| `CDK_TOOLKIT_E0101` | A notice that is marked as an error | `error` | n/a |
| `CDK_TOOLKIT_I0101` | A notice that is marked as informational | `info` | n/a |
| `CDK_ASSEMBLY_I0010` | Generic environment preparation debug messages | `debug` | n/a |
| `CDK_ASSEMBLY_W0010` | Emitted if the found framework version does not support context overflow | `warn` | n/a |
| `CDK_ASSEMBLY_I0042` | Writing context updates | `debug` | {@link UpdatedContext} |
| `CDK_ASSEMBLY_I0240` | Context lookup was stopped as no further progress was made.  | `debug` | {@link MissingContext} |
| `CDK_ASSEMBLY_I0241` | Fetching missing context. This is an iterative message that may appear multiple times with different missing keys. | `debug` | {@link MissingContext} |
| `CDK_ASSEMBLY_I1000` | Cloud assembly output starts | `debug` | n/a |
| `CDK_ASSEMBLY_I1001` | Output lines emitted by the cloud assembly to stdout | `info` | n/a |
| `CDK_ASSEMBLY_E1002` | Output lines emitted by the cloud assembly to stderr | `error` | n/a |
| `CDK_ASSEMBLY_I1003` | Cloud assembly output finished | `info` | n/a |
| `CDK_ASSEMBLY_E1111` | Incompatible CDK CLI version. Upgrade needed. | `error` | {@link ErrorPayload} |
| `CDK_ASSEMBLY_I0150` | Indicates the use of a pre-synthesized cloud assembly directory | `debug` | n/a |
| `CDK_ASSEMBLY_I0300` | An info message emitted by a Context Provider | `info` | {@link ContextProviderMessageSource} |
| `CDK_ASSEMBLY_I0301` | A debug message emitted by a Context Provider | `debug` | {@link ContextProviderMessageSource} |
| `CDK_ASSEMBLY_I9999` | Annotations emitted by the cloud assembly | `info` | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.SynthesisMessage.html) |
| `CDK_ASSEMBLY_W9999` | Warnings emitted by the cloud assembly | `warn` | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.SynthesisMessage.html) |
| `CDK_ASSEMBLY_E9999` | Errors emitted by the cloud assembly | `error` | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.SynthesisMessage.html) |
| `CDK_SDK_I0100` | An SDK trace. SDK traces are emitted as traces to the IoHost, but contain the original SDK logging level. | `trace` | {@link SdkTrace} |
| `CDK_SDK_I1100` | Get an MFA token for an MFA device. | `info` | {@link MfaTokenRequest} |
| `CDK_TOOLKIT_I9300` | Confirm the feature flag configuration changes | `info` | {@link ConfirmationRequest} |