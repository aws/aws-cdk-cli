## Toolkit Code Registry

| Code | Description | Level | Data Interface |
|------|-------------|-------|----------------|
| CDK_TOOLKIT_I0000 | Default info messages emitted from the Toolkit | info | n/a |
| CDK_TOOLKIT_I0000 | Default debug messages emitted from the Toolkit | debug | n/a |
| CDK_TOOLKIT_W0000 | Default warning messages emitted from the Toolkit | warn | n/a |
| CDK_TOOLKIT_I1000 | Provides synthesis times. | info | [Duration](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/Duration.html) |
| CDK_TOOLKIT_I1901 | Provides stack data | result | [StackAndAssemblyData](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/StackAndAssemblyData.html) |
| CDK_TOOLKIT_I1902 | Successfully deployed stacks | result | [AssemblyData](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/AssemblyData.html) |
| CDK_TOOLKIT_I2901 | Provides details on the selected stacks and their dependencies | result | [StackDetailsPayload](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/StackDetailsPayload.html) |
| CDK_TOOLKIT_E3900 | Resource import failed | error | n/a |
| CDK_TOOLKIT_I5000 | Provides deployment times | info | [Duration](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/Duration.html) |
| CDK_TOOLKIT_I5001 | Provides total time in deploy action, including synth and rollback | info | [Duration](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/Duration.html) |
| CDK_TOOLKIT_I5002 | Provides time for resource migration | info | n/a |
| CDK_TOOLKIT_W5021 | Empty non-existent stack, deployment is skipped | warn | n/a |
| CDK_TOOLKIT_W5022 | Empty existing stack, stack will be destroyed | warn | n/a |
| CDK_TOOLKIT_I5031 | Informs about any log groups that are traced as part of the deployment | info | n/a |
| CDK_TOOLKIT_I5050 | Confirm rollback during deployment | info | [ConfirmationRequest](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/ConfirmationRequest.html) |
| CDK_TOOLKIT_I5060 | Confirm deploy security sensitive changes | info | [ConfirmationRequest](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/ConfirmationRequest.html) |
| CDK_TOOLKIT_I5100 | Stack deploy progress | info | [StackDeployProgress](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/StackDeployProgress.html) |
| CDK_TOOLKIT_I5310 | The computed settings used for file watching | debug | [WatchSettings](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/WatchSettings.html) |
| CDK_TOOLKIT_I5311 | File watching started | info | [FileWatchEvent](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/FileWatchEvent.html) |
| CDK_TOOLKIT_I5312 | File event detected, starting deployment | info | [FileWatchEvent](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/FileWatchEvent.html) |
| CDK_TOOLKIT_I5313 | File event detected during active deployment, changes are queued | info | [FileWatchEvent](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/FileWatchEvent.html) |
| CDK_TOOLKIT_I5314 | Initial watch deployment started | info | n/a |
| CDK_TOOLKIT_I5315 | Queued watch deployment started | info | n/a |
| CDK_TOOLKIT_I5501 | Stack Monitoring: Start monitoring of a single stack | info | [StackMonitoringControlEvent](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/StackMonitoringControlEvent.html) |
| CDK_TOOLKIT_I5502 | Stack Monitoring: Activity event for a single stack | info | [StackActivity](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/StackActivity.html) |
| CDK_TOOLKIT_I5503 | Stack Monitoring: Finished monitoring of a single stack | info | [StackMonitoringControlEvent](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/StackMonitoringControlEvent.html) |
| CDK_TOOLKIT_I5900 | Deployment results on success | result | [SuccessfulDeployStackResult](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/SuccessfulDeployStackResult.html) |
| CDK_TOOLKIT_I5901 | Generic deployment success messages | info | n/a |
| CDK_TOOLKIT_W5400 | Hotswap disclosure message | warn | n/a |
| CDK_TOOLKIT_E5001 | No stacks found | error | n/a |
| CDK_TOOLKIT_E5500 | Stack Monitoring error | error | [ErrorPayload](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/ErrorPayload.html) |
| CDK_TOOLKIT_I6000 | Provides rollback times | info | [Duration](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/Duration.html) |
| CDK_TOOLKIT_I6100 | Stack rollback progress | info | [StackRollbackProgress](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/StackRollbackProgress.html) |
| CDK_TOOLKIT_E6001 | No stacks found | error | n/a |
| CDK_TOOLKIT_E6900 | Rollback failed | error | [ErrorPayload](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/ErrorPayload.html) |
| CDK_TOOLKIT_I7000 | Provides destroy times | info | [Duration](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/Duration.html) |
| CDK_TOOLKIT_I7010 | Confirm destroy stacks | info | [ConfirmationRequest](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/ConfirmationRequest.html) |
| CDK_TOOLKIT_I7100 | Stack destroy progress | info | [StackDestroyProgress](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/StackDestroyProgress.html) |
| CDK_TOOLKIT_I7900 | Stack deletion succeeded | result | [cxapi.CloudFormationStackArtifact](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/cxapi.CloudFormationStackArtifact.html) |
| CDK_TOOLKIT_E7010 | Action was aborted due to negative confirmation of request | error | n/a |
| CDK_TOOLKIT_E7900 | Stack deletion failed | error | [ErrorPayload](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/ErrorPayload.html) |
| CDK_TOOLKIT_I9000 | Provides bootstrap times | info | [Duration](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/Duration.html) |
| CDK_TOOLKIT_I9100 | Bootstrap progress | info | [BootstrapEnvironmentProgress](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/BootstrapEnvironmentProgress.html) |
| CDK_TOOLKIT_I9900 | Bootstrap results on success | result | [cxapi.Environment](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/cxapi.Environment.html) |
| CDK_TOOLKIT_E9900 | Bootstrap failed | error | [ErrorPayload](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/ErrorPayload.html) |
| CDK_ASSEMBLY_I0010 | Generic environment preparation debug messages | debug | n/a |
| CDK_ASSEMBLY_W0010 | Emitted if the found framework version does not support context overflow | warn | n/a |
| CDK_ASSEMBLY_I0042 | Writing updated context | debug | [UpdatedContext](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/UpdatedContext.html) |
| CDK_ASSEMBLY_I0240 | Context lookup was stopped as no further progress was made.  | debug | [MissingContext](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/MissingContext.html) |
| CDK_ASSEMBLY_I0241 | Fetching missing context. This is an iterative message that may appear multiple times with different missing keys. | debug | [MissingContext](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/MissingContext.html) |
| CDK_ASSEMBLY_I1000 | Cloud assembly output starts | debug | n/a |
| CDK_ASSEMBLY_I1001 | Output lines emitted by the cloud assembly to stdout | info | n/a |
| CDK_ASSEMBLY_E1002 | Output lines emitted by the cloud assembly to stderr | error | n/a |
| CDK_ASSEMBLY_I1003 | Cloud assembly output finished | info | n/a |
| CDK_ASSEMBLY_E1111 | Incompatible CDK CLI version. Upgrade needed. | error | [ErrorPayload](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/ErrorPayload.html) |
| CDK_ASSEMBLY_I0150 | Indicates the use of a pre-synthesized cloud assembly directory | debug | n/a |
| CDK_ASSEMBLY_I9999 | Annotations emitted by the cloud assembly | info | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/cxapi.SynthesisMessage.html) |
| CDK_ASSEMBLY_W9999 | Warnings emitted by the cloud assembly | warn | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/cxapi.SynthesisMessage.html) |
| CDK_ASSEMBLY_E9999 | Errors emitted by the cloud assembly | error | [cxapi.SynthesisMessage](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/cxapi.SynthesisMessage.html) |
| CDK_SDK_I0100 | An SDK trace. SDK traces are emitted as traces to the IoHost, but contain the original SDK logging level. | trace | [SdkTrace](https://docs.aws.amazon.com/cdk/api/toolkit-lib/interfaces/SdkTrace.html) |
