---
title: IoMessages Registry
group: Documents
---
# IoMessages Registry

| Code | Description | Level | Data Interface |
|------|-------------|-------|----------------|
| `CDK_TOOLKIT_I0000` | Default info messages emitted from the Toolkit | `info` | n/a |
| `CDK_TOOLKIT_I0000` | Default debug messages emitted from the Toolkit | `debug` | n/a |
| `CDK_TOOLKIT_W0000` | Default warning messages emitted from the Toolkit | `warn` | n/a |
| `CDK_TOOLKIT_I1000` | Provides synthesis times. | `info` | {@link Duration} |
| `CDK_TOOLKIT_I1901` | Provides stack data | `result` | {@link StackAndAssemblyData} |
| `CDK_TOOLKIT_I1902` | Successfully deployed stacks | `result` | {@link AssemblyData} |
| `CDK_TOOLKIT_I2901` | Provides details on the selected stacks and their dependencies | `result` | {@link StackDetailsPayload} |
| `CDK_TOOLKIT_E3900` | Resource import failed | `error` | n/a |
| `CDK_TOOLKIT_I5000` | Provides deployment times | `info` | {@link Duration} |
| `CDK_TOOLKIT_I5001` | Provides total time in deploy action, including synth and rollback | `info` | {@link Duration} |
| `CDK_TOOLKIT_I5002` | Provides time for resource migration | `info` | n/a |
| `CDK_TOOLKIT_W5021` | Empty non-existent stack, deployment is skipped | `warn` | n/a |
| `CDK_TOOLKIT_W5022` | Empty existing stack, stack will be destroyed | `warn` | n/a |
| `CDK_TOOLKIT_I5031` | Informs about any log groups that are traced as part of the deployment | `info` | n/a |
| `CDK_TOOLKIT_I5050` | Confirm rollback during deployment | `info` | {@link ConfirmationRequest} |
| `CDK_TOOLKIT_I5060` | Confirm deploy security sensitive changes | `info` | {@link DeployConfirmationRequest} |
| `CDK_TOOLKIT_I5100` | Stack deploy progress | `info` | {@link StackDeployProgress} |
| `CDK_TOOLKIT_I5310` | The computed settings used for file watching | `debug` | {@link WatchSettings} |
| `CDK_TOOLKIT_I5311` | File watching started | `info` | {@link FileWatchEvent} |
| `CDK_TOOLKIT_I5312` | File event detected, starting deployment | `info` | {@link FileWatchEvent} |
| `CDK_TOOLKIT_I5313` | File event detected during active deployment, changes are queued | `info` | {@link FileWatchEvent} |
| `CDK_TOOLKIT_I5314` | Initial watch deployment started | `info` | n/a |
| `CDK_TOOLKIT_I5315` | Queued watch deployment started | `info` | n/a |
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
| `CDK_TOOLKIT_I7010` | Confirm destroy stacks | `info` | {@link ConfirmationRequest} |
| `CDK_TOOLKIT_I7100` | Stack destroy progress | `info` | {@link StackDestroyProgress} |
| `CDK_TOOLKIT_I7900` | Stack deletion succeeded | `result` | [cxapi.CloudFormationStackArtifact](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.CloudFormationStackArtifact.html) |
| `CDK_TOOLKIT_E7010` | Action was aborted due to negative confirmation of request | `error` | n/a |
| `CDK_TOOLKIT_E7900` | Stack deletion failed | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_I9000` | Provides bootstrap times | `info` | {@link Duration} |
| `CDK_TOOLKIT_I9100` | Bootstrap progress | `info` | {@link BootstrapEnvironmentProgress} |
| `CDK_TOOLKIT_I9900` | Bootstrap results on success | `result` | [cxapi.Environment](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.Environment.html) |
| `CDK_TOOLKIT_E9900` | Bootstrap failed | `error` | {@link ErrorPayload} |
| `CDK_TOOLKIT_I0100` | Notices decoration (the header or footer of a list of notices) | `info` | n/a |
| `CDK_TOOLKIT_W0101` | A notice that is marked as a warning | `warn` | n/a |
| `CDK_TOOLKIT_E0101` | A notice that is marked as an error | `error` | n/a |
| `CDK_TOOLKIT_I0101` | A notice that is marked as informational | `info` | n/a |
| `CDK_ASSEMBLY_I0010` | Generic environment preparation debug messages | `debug` | n/a |
| `CDK_ASSEMBLY_W0010` | Emitted if the found framework version does not support context overflow | `warn` | n/a |
| `CDK_ASSEMBLY_I0042` | Writing updated context | `debug` | {@link UpdatedContext} |
| `CDK_ASSEMBLY_I0240` | Context lookup was stopped as no further progress was made.  | `debug` | {@link MissingContext} |
| `CDK_ASSEMBLY_I0241` | Fetching missing context. This is an iterative message that may appear multiple times with different missing keys. | `debug` | {@link MissingContext} |
| `CDK_ASSEMBLY_I1000` | Cloud assembly output starts | `debug` | n/a |
| `CDK_ASSEMBLY_I1001` | Output lines emitted by the cloud assembly to stdout | `info` | n/a |
| `CDK_ASSEMBLY_E1002` | Output lines emitted by the cloud assembly to stderr | `error` | n/a |
| `CDK_ASSEMBLY_I1003` | Cloud assembly output finished | `info` | n/a |
| `CDK_ASSEMBLY_E1111` | Incompatible CDK CLI version. Upgrade needed. | `error` | {@link ErrorPayload} |
| `CDK_ASSEMBLY_I0150` | Indicates the use of a pre-synthesized cloud assembly directory | `debug` | n/a |
| `CDK_ASSEMBLY_I9999` | Annotations emitted by the cloud assembly | `info` | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.SynthesisMessage.html) |
| `CDK_ASSEMBLY_W9999` | Warnings emitted by the cloud assembly | `warn` | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.SynthesisMessage.html) |
| `CDK_ASSEMBLY_E9999` | Errors emitted by the cloud assembly | `error` | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_cx-api.SynthesisMessage.html) |
| `CDK_SDK_I0000` | An SDK message. | `trace` | n/a |
| `CDK_SDK_I0100` | An SDK trace. SDK traces are emitted as traces to the IoHost, but contain the original SDK logging level. | `trace` | {@link SdkTrace} |
