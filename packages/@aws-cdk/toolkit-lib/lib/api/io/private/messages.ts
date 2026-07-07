import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { confirm, debug, error, info, question, result, trace, warn } from './message-maker';
import type { SpanDefinition } from './span';
import type { DiagnosedStack } from '../../../actions/diagnose';
import type { ValidateResult } from '../../../actions/validate';
import type { StackDiff, DiffResult } from '../../../payloads';
import type { BootstrapEnvironmentProgress } from '../../../payloads/bootstrap-environment-progress';
import type { MissingContext, UpdatedContext } from '../../../payloads/context';
import type { BuildAsset, DeployConfirmationRequest, PublishAsset, PublishAssetEvent, StackDeployProgress, SuccessfulDeployStackResult } from '../../../payloads/deploy';
import type { StackDestroy, StackDestroyProgress } from '../../../payloads/destroy';
import type { DriftResultPayload } from '../../../payloads/drift';
import type { FeatureFlagChangeRequest } from '../../../payloads/flags';
import type { AssetBatchDeletionRequest } from '../../../payloads/gc';
import type { HotswapDeploymentDetails, HotswapDeploymentAttempt, HotswappableChange, HotswapResult } from '../../../payloads/hotswap';
import type { ResourceIdentificationRequest, ResourceImportRequest } from '../../../payloads/import';
import type { StackDetailsPayload } from '../../../payloads/list';
import type { CloudWatchLogEvent, CloudWatchLogMonitorControlEvent } from '../../../payloads/logs-monitor';
import type { AssetsPayload } from '../../../payloads/publish-assets';
import type { RefactorResult } from '../../../payloads/refactor';
import type { StackRollbackProgress } from '../../../payloads/rollback';
import type { MfaTokenRequest, SdkTrace } from '../../../payloads/sdk';
import type { StackActivity, StackMonitoringControlEvent } from '../../../payloads/stack-activity';
import type { StackSelectionDetails } from '../../../payloads/synth';
import type {
  AssemblyData,
  ConfirmationRequest,
  ContextProviderMessageSource,
  Duration,
  ErrorPayload,
  Operation,
  SingleStack,
  StackAndAssemblyData,
} from '../../../payloads/types';
import type { FileWatchEvent, WatchSettings } from '../../../payloads/watch';

/**
 * We have a rough system by which we assign message codes:
 * - First digit groups messages by action, e.g. synth or deploy
 * - X000-X009 are reserved for timings
 * - X900-X999 are reserved for results
 */
export const IO = {
  // warnings & errors
  CDK_TOOLKIT_W0100: warn({
    code: 'CDK_TOOLKIT_W0100',
    description: 'Credential plugin warnings',
  }),

  // 1: Synth (1xxx)
  CDK_TOOLKIT_I1000: info<Operation>({
    code: 'CDK_TOOLKIT_I1000',
    description: 'Provides synthesis times.',
    interface: 'Operation',
  }),
  CDK_TOOLKIT_I1001: trace<StackSelectionDetails>({
    code: 'CDK_TOOLKIT_I1001',
    description: 'Cloud Assembly synthesis is starting',
    interface: 'StackSelectionDetails',
  }),
  CDK_TOOLKIT_I1002: info({
    code: 'CDK_TOOLKIT_I1002',
    description: 'Stacks added to the selection because they are dependencies of the selected stacks (upstream expansion)',
  }),
  CDK_TOOLKIT_I1003: info({
    code: 'CDK_TOOLKIT_I1003',
    description: 'Stacks added to the selection because they are dependent on the selected stacks (downstream expansion)',
  }),
  CDK_TOOLKIT_I1901: result<StackAndAssemblyData>({
    code: 'CDK_TOOLKIT_I1901',
    description: 'Provides stack data',
    interface: 'StackAndAssemblyData',
  }),
  CDK_TOOLKIT_I1902: result<AssemblyData>({
    code: 'CDK_TOOLKIT_I1902',
    description: 'Successfully deployed stacks',
    interface: 'AssemblyData',
  }),

  // 2: List (2xxx)
  CDK_TOOLKIT_I2901: result<StackDetailsPayload>({
    code: 'CDK_TOOLKIT_I2901',
    description: 'Provides details on the selected stacks and their dependencies',
    interface: 'StackDetailsPayload',
  }),

  // 3: Import & Migrate
  CDK_TOOLKIT_I3100: confirm<ResourceImportRequest>({
    code: 'CDK_TOOLKIT_I3100',
    description: 'Confirm the import of a specific resource',
    interface: 'ResourceImportRequest',
  }),
  CDK_TOOLKIT_I3110: question<ResourceIdentificationRequest>({
    code: 'CDK_TOOLKIT_I3110',
    description: 'Additional information is needed to identify a resource',
    interface: 'ResourceIdentificationRequest',
  }),
  CDK_TOOLKIT_E3900: error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E3900',
    description: 'Resource import failed',
    interface: 'ErrorPayload',
  }),

  // 4: Diff (40xx - 44xx)
  CDK_TOOLKIT_I4000: trace<StackSelectionDetails>({
    code: 'CDK_TOOLKIT_I4000',
    description: 'Diff stacks is starting',
    interface: 'StackSelectionDetails',
  }),
  CDK_TOOLKIT_I4001: result<DiffResult>({
    code: 'CDK_TOOLKIT_I4001',
    description: 'Output of the diff command',
    interface: 'DiffResult',
  }),
  CDK_TOOLKIT_I4002: result<StackDiff>({
    code: 'CDK_TOOLKIT_I4002',
    description: 'The diff for a single stack',
    interface: 'StackDiff',
  }),

  // 4: Drift (45xx - 49xx)
  CDK_TOOLKIT_I4500: trace<StackSelectionDetails>({
    code: 'CDK_TOOLKIT_I4500',
    description: 'Drift detection is starting',
    interface: 'StackSelectionDetails',
  }),
  CDK_TOOLKIT_I4509: result<Duration>({
    code: 'CDK_TOOLKIT_I4592',
    description: 'Results of the drift',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I4590: result<DriftResultPayload>({
    code: 'CDK_TOOLKIT_I4590',
    description: 'Results of a stack drift',
    interface: 'DriftResultPayload',
  }),
  CDK_TOOLKIT_W4591: warn<SingleStack>({
    code: 'CDK_TOOLKIT_W4591',
    description: 'Missing drift result fort a stack.',
    interface: 'SingleStack',
  }),

  // 5: Deploy & Watch (5xxx)
  CDK_TOOLKIT_I5000: info<Duration>({
    code: 'CDK_TOOLKIT_I5000',
    description: 'Provides deployment times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I5001: info<Duration>({
    code: 'CDK_TOOLKIT_I5001',
    description: 'Provides total time in deploy action, including synth and rollback',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I5002: info<Duration>({
    code: 'CDK_TOOLKIT_I5002',
    description: 'Provides time for resource migration',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_W5021: warn({
    code: 'CDK_TOOLKIT_W5021',
    description: 'Empty non-existent stack, deployment is skipped',
  }),
  CDK_TOOLKIT_W5022: warn({
    code: 'CDK_TOOLKIT_W5022',
    description: 'Empty existing stack, stack will be destroyed',
  }),
  CDK_TOOLKIT_I5031: info({
    code: 'CDK_TOOLKIT_I5031',
    description: 'Informs about any log groups that are traced as part of the deployment',
  }),
  CDK_TOOLKIT_I5032: debug<CloudWatchLogMonitorControlEvent>({
    code: 'CDK_TOOLKIT_I5032',
    description: 'Start monitoring log groups',
    interface: 'CloudWatchLogMonitorControlEvent',
  }),
  CDK_TOOLKIT_I5033: info<CloudWatchLogEvent>({
    code: 'CDK_TOOLKIT_I5033',
    description: 'A log event received from Cloud Watch',
    interface: 'CloudWatchLogEvent',
  }),
  CDK_TOOLKIT_I5034: debug<CloudWatchLogMonitorControlEvent>({
    code: 'CDK_TOOLKIT_I5034',
    description: 'Stop monitoring log groups',
    interface: 'CloudWatchLogMonitorControlEvent',
  }),
  CDK_TOOLKIT_E5035: error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E5035',
    description: 'A log monitoring error',
    interface: 'ErrorPayload',
  }),
  CDK_TOOLKIT_I5050: confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I5050',
    description: 'Confirm rollback during deployment',
    interface: 'ConfirmationRequest',
  }),
  CDK_TOOLKIT_I5060: confirm<DeployConfirmationRequest>({
    code: 'CDK_TOOLKIT_I5060',
    description: 'Confirm deploy security sensitive changes',
    interface: 'DeployConfirmationRequest',
  }),
  CDK_TOOLKIT_I5100: info<StackDeployProgress>({
    code: 'CDK_TOOLKIT_I5100',
    description: 'Stack deploy progress',
    interface: 'StackDeployProgress',
  }),

  // Assets (52xx)
  CDK_TOOLKIT_I5210: trace<BuildAsset>({
    code: 'CDK_TOOLKIT_I5210',
    description: 'Started building a specific asset',
    interface: 'BuildAsset',
  }),
  CDK_TOOLKIT_I5211: trace<Duration>({
    code: 'CDK_TOOLKIT_I5211',
    description: 'Building the asset has completed',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I5220: trace<PublishAsset>({
    code: 'CDK_TOOLKIT_I5220',
    description: 'Started publishing a specific asset',
    interface: 'PublishAsset',
  }),
  CDK_TOOLKIT_I5221: trace<Duration>({
    code: 'CDK_TOOLKIT_I5221',
    description: 'Publishing the asset has completed',
    interface: 'Duration',
  }),

  CDK_ASSETS_I5270: info<PublishAssetEvent>({
    code: 'CDK_ASSETS_I5270',
    description: 'Publishing the asset has started',
    interface: 'PublishAssetEvent',
  }),
  CDK_ASSETS_I5271: debug<PublishAssetEvent>({
    code: 'CDK_ASSETS_I5271',
    description: 'Debug messaged emitted during publishing of the asset',
    interface: 'PublishAssetEvent',
  }),
  CDK_ASSETS_I5275: info<PublishAssetEvent>({
    code: 'CDK_ASSETS_I5275',
    description: 'Publishing the asset has completed successfully',
    interface: 'PublishAssetEvent',
  }),
  CDK_ASSETS_E5279: error<PublishAssetEvent>({
    code: 'CDK_ASSETS_E5279',
    description: 'There was an error while publishing the asset',
    interface: 'PublishAssetEvent',
  }),

  // Watch (53xx)
  CDK_TOOLKIT_I5310: debug<WatchSettings>({
    code: 'CDK_TOOLKIT_I5310',
    description: 'The computed settings used for file watching',
    interface: 'WatchSettings',
  }),
  CDK_TOOLKIT_I5311: info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5311',
    description: 'File watching started',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5312: info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5312',
    description: 'File event detected, starting deployment',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5313: info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5313',
    description: 'File event detected during active deployment, changes are queued',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5314: info({
    code: 'CDK_TOOLKIT_I5314',
    description: 'Initial watch deployment started',
  }),
  CDK_TOOLKIT_I5315: info({
    code: 'CDK_TOOLKIT_I5315',
    description: 'Queued watch deployment started',
  }),

  // Hotswap (54xx)
  CDK_TOOLKIT_I5400: trace<HotswapDeploymentAttempt>({
    code: 'CDK_TOOLKIT_I5400',
    description: 'Attempting a hotswap deployment',
    interface: 'HotswapDeploymentAttempt',
  }),
  CDK_TOOLKIT_I5401: trace<HotswapDeploymentDetails>({
    code: 'CDK_TOOLKIT_I5401',
    description: 'Computed details for the hotswap deployment',
    interface: 'HotswapDeploymentDetails',
  }),
  CDK_TOOLKIT_I5402: info<HotswappableChange>({
    code: 'CDK_TOOLKIT_I5402',
    description: 'A hotswappable change is processed as part of a hotswap deployment',
    interface: 'HotswappableChange',
  }),
  CDK_TOOLKIT_I5403: info<HotswappableChange>({
    code: 'CDK_TOOLKIT_I5403',
    description: 'The hotswappable change has completed processing',
    interface: 'HotswappableChange',
  }),
  CDK_TOOLKIT_I5410: info<HotswapResult>({
    code: 'CDK_TOOLKIT_I5410',
    description: 'Hotswap deployment has ended, a full deployment might still follow if needed',
    interface: 'HotswapResult',
  }),

  // Stack Monitor (55xx)
  CDK_TOOLKIT_I5501: info<StackMonitoringControlEvent>({
    code: 'CDK_TOOLKIT_I5501',
    description: 'Stack Monitoring: Start monitoring of a single stack',
    interface: 'StackMonitoringControlEvent',
  }),
  CDK_TOOLKIT_I5502: info<StackActivity>({
    code: 'CDK_TOOLKIT_I5502',
    description: 'Stack Monitoring: Activity event for a single stack',
    interface: 'StackActivity',
  }),
  CDK_TOOLKIT_I5503: info<StackMonitoringControlEvent>({
    code: 'CDK_TOOLKIT_I5503',
    description: 'Stack Monitoring: Finished monitoring of a single stack',
    interface: 'StackMonitoringControlEvent',
  }),

  // Success (59xx)
  CDK_TOOLKIT_I5900: result<SuccessfulDeployStackResult>({
    code: 'CDK_TOOLKIT_I5900',
    description: 'Deployment results on success',
    interface: 'SuccessfulDeployStackResult',
  }),
  CDK_TOOLKIT_I5901: info({
    code: 'CDK_TOOLKIT_I5901',
    description: 'Generic deployment success messages',
  }),
  CDK_TOOLKIT_W5902: warn({
    code: 'CDK_TOOLKIT_W5902',
    description: 'Express Mode deployment completed with resources still stabilizing',
  }),
  CDK_TOOLKIT_W5400: warn({
    code: 'CDK_TOOLKIT_W5400',
    description: 'Hotswap disclosure message',
  }),

  CDK_TOOLKIT_E5001: error({
    code: 'CDK_TOOLKIT_E5001',
    description: 'No stacks found',
  }),
  CDK_TOOLKIT_E5500: error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E5500',
    description: 'Stack Monitoring error',
    interface: 'ErrorPayload',
  }),

  // 6: Rollback (6xxx)
  CDK_TOOLKIT_I6000: info<Duration>({
    code: 'CDK_TOOLKIT_I6000',
    description: 'Provides rollback times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I6100: info<StackRollbackProgress>({
    code: 'CDK_TOOLKIT_I6100',
    description: 'Stack rollback progress',
    interface: 'StackRollbackProgress',
  }),

  CDK_TOOLKIT_E6001: error({
    code: 'CDK_TOOLKIT_E6001',
    description: 'No stacks found',
  }),
  CDK_TOOLKIT_E6900: error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E6900',
    description: 'Rollback failed',
    interface: 'ErrorPayload',
  }),

  // 7: Destroy (7xxx)
  CDK_TOOLKIT_I7000: info<Duration>({
    code: 'CDK_TOOLKIT_I7000',
    description: 'Provides destroy times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I7001: trace<Duration>({
    code: 'CDK_TOOLKIT_I7001',
    description: 'Provides destroy time for a single stack',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I7010: confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I7010',
    description: 'Confirm destroy stacks',
    interface: 'ConfirmationRequest',
  }),
  CDK_TOOLKIT_I7100: info<StackDestroyProgress>({
    code: 'CDK_TOOLKIT_I7100',
    description: 'Stack destroy progress',
    interface: 'StackDestroyProgress',
  }),
  CDK_TOOLKIT_I7101: trace<StackDestroy>({
    code: 'CDK_TOOLKIT_I7101',
    description: 'Start stack destroying',
    interface: 'StackDestroy',
  }),

  CDK_TOOLKIT_I7900: result<cxapi.CloudFormationStackArtifact>({
    code: 'CDK_TOOLKIT_I7900',
    description: 'Stack deletion succeeded',
    interface: 'cxapi.CloudFormationStackArtifact',
  }),

  CDK_TOOLKIT_W7902: warn({
    code: 'CDK_TOOLKIT_W7902',
    description: 'Express Mode deletion completed with resources still tearing down',
  }),

  CDK_TOOLKIT_E7010: error({
    code: 'CDK_TOOLKIT_E7010',
    description: 'Action was aborted due to negative confirmation of request',
  }),
  CDK_TOOLKIT_E7900: error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E7900',
    description: 'Stack deletion failed',
    interface: 'ErrorPayload',
  }),

  // 8. Refactor (8xxx)
  CDK_TOOLKIT_E8900: error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E8900',
    description: 'Stack refactor failed',
    interface: 'ErrorPayload',
  }),

  CDK_TOOLKIT_I8900: result<RefactorResult>({
    code: 'CDK_TOOLKIT_I8900',
    description: 'Refactor result',
    interface: 'RefactorResult',
  }),

  CDK_TOOLKIT_I8910: confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I8910',
    description: 'Confirm refactor',
    interface: 'ConfirmationRequest',
  }),

  CDK_TOOLKIT_W8010: warn({
    code: 'CDK_TOOLKIT_W8010',
    description: 'Refactor execution not yet supported',
  }),

  // Orphan (88xx)
  CDK_TOOLKIT_I8810: confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I8810',
    description: 'Confirm orphan resources',
    interface: 'ConfirmationRequest',
  }),

  // 9: Bootstrap, gc, flags & publish (9xxx)
  CDK_TOOLKIT_I9000: info<Duration>({
    code: 'CDK_TOOLKIT_I9000',
    description: 'Provides bootstrap times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I9100: info<BootstrapEnvironmentProgress>({
    code: 'CDK_TOOLKIT_I9100',
    description: 'Bootstrap progress',
    interface: 'BootstrapEnvironmentProgress',
  }),

  // gc (92xx)
  CDK_TOOLKIT_I9210: question<AssetBatchDeletionRequest>({
    code: 'CDK_TOOLKIT_I9210',
    description: 'Confirm the deletion of a batch of assets',
    interface: 'AssetBatchDeletionRequest',
  }),

  CDK_TOOLKIT_I9900: result<{ environment: cxapi.Environment }>({
    code: 'CDK_TOOLKIT_I9900',
    description: 'Bootstrap results on success',
    interface: 'cxapi.Environment',
  }),
  CDK_TOOLKIT_W9902: warn({
    code: 'CDK_TOOLKIT_W9902',
    description: 'Bootstrap completed with Express Mode, resources still stabilizing',
  }),
  CDK_TOOLKIT_E9900: error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E9900',
    description: 'Bootstrap failed',
    interface: 'ErrorPayload',
  }),

  // flags (93xx)
  CDK_TOOLKIT_I9300: info<FeatureFlagChangeRequest>({
    code: 'CDK_TOOLKIT_I9300',
    description: 'Confirm the feature flag configuration changes',
    interface: 'FeatureFlagChangeRequest',
  }),

  // publish (94xx)
  CDK_TOOLKIT_I9400: info({
    code: 'CDK_TOOLKIT_I9400',
    description: 'All assets are already published',
  }),
  CDK_TOOLKIT_I9401: info<AssetsPayload>({
    code: 'CDK_TOOLKIT_I9401',
    description: 'Publishing assets',
    interface: 'AssetsPayload',
  }),
  CDK_TOOLKIT_I9402: result<AssetsPayload>({
    code: 'CDK_TOOLKIT_I9402',
    description: 'Publish assets results on success',
    interface: 'AssetsPayload',
  }),

  // diagnose (95xx)
  CDK_TOOLKIT_I9500: info<DiagnosedStack>({
    code: 'CDK_TOOLKIT_I9500',
    description: 'Stack diagnosis (no problems found)',
    interface: 'DiagnosedStack',
  }),

  CDK_TOOLKIT_E9500: error<DiagnosedStack>({
    code: 'CDK_TOOLKIT_E9500',
    description: 'Stack diagnosis (problems found)',
    interface: 'DiagnosedStack',
  }),

  CDK_TOOLKIT_W9501: warn<DiagnosedStack>({
    code: 'CDK_TOOLKIT_W9501',
    description: 'Stack diagnosis (diagnosis could not be performed)',
    interface: 'DiagnosedStack',
  }),

  // validate (96xx)
  CDK_TOOLKIT_I9600: info<ValidateResult>({
    code: 'CDK_TOOLKIT_I9600',
    description: 'Validation did not find any problems',
    interface: 'ValidateResult',
  }),

  CDK_TOOLKIT_E9600: error<ValidateResult>({
    code: 'CDK_TOOLKIT_E9600',
    description: 'Policy validation failed',
    interface: 'ValidateResult',
  }),

  CDK_TOOLKIT_I9601: info({
    code: 'CDK_TOOLKIT_I9601',
    description: 'No policy validation report found',
  }),

  CDK_TOOLKIT_W9602: warn({
    code: 'CDK_TOOLKIT_W9602',
    description: 'Online validation could not be completed for a stack',
  }),

  // Notices
  CDK_TOOLKIT_I0100: info({
    code: 'CDK_TOOLKIT_I0100',
    description: 'Notices decoration (the header or footer of a list of notices)',
  }),
  CDK_TOOLKIT_W0101: warn({
    code: 'CDK_TOOLKIT_W0101',
    description: 'A notice that is marked as a warning',
  }),
  CDK_TOOLKIT_E0101: error({
    code: 'CDK_TOOLKIT_E0101',
    description: 'A notice that is marked as an error',
  }),
  CDK_TOOLKIT_I0101: info({
    code: 'CDK_TOOLKIT_I0101',
    description: 'A notice that is marked as informational',
  }),

  // Assembly codes
  CDK_ASSEMBLY_I0010: debug({
    code: 'CDK_ASSEMBLY_I0010',
    description: 'Generic environment preparation debug messages',
  }),
  CDK_ASSEMBLY_W0010: warn({
    code: 'CDK_ASSEMBLY_W0010',
    description: 'Emitted if the found framework version does not support context overflow',
  }),
  CDK_ASSEMBLY_I0042: debug<UpdatedContext>({
    code: 'CDK_ASSEMBLY_I0042',
    description: 'Writing context updates',
    interface: 'UpdatedContext',
  }),
  CDK_ASSEMBLY_I0240: debug<MissingContext>({
    code: 'CDK_ASSEMBLY_I0240',
    description: 'Context lookup was stopped as no further progress was made. ',
    interface: 'MissingContext',
  }),
  CDK_ASSEMBLY_I0241: debug<MissingContext>({
    code: 'CDK_ASSEMBLY_I0241',
    description: 'Fetching missing context. This is an iterative message that may appear multiple times with different missing keys.',
    interface: 'MissingContext',
  }),
  CDK_ASSEMBLY_I1000: debug({
    code: 'CDK_ASSEMBLY_I1000',
    description: 'Cloud assembly output starts',
  }),
  CDK_ASSEMBLY_I1001: info({
    code: 'CDK_ASSEMBLY_I1001',
    description: 'Output lines emitted by the cloud assembly to stdout',
  }),
  CDK_ASSEMBLY_E1002: error({
    code: 'CDK_ASSEMBLY_E1002',
    description: 'Output lines emitted by the cloud assembly to stderr',
  }),
  CDK_ASSEMBLY_I1003: info({
    code: 'CDK_ASSEMBLY_I1003',
    description: 'Cloud assembly output finished',
  }),
  CDK_ASSEMBLY_E1111: error<ErrorPayload>({
    code: 'CDK_ASSEMBLY_E1111',
    description: 'Incompatible CDK CLI version. Upgrade needed.',
    interface: 'ErrorPayload',
  }),

  CDK_ASSEMBLY_I0150: debug<never>({
    code: 'CDK_ASSEMBLY_I0150',
    description: 'Indicates the use of a pre-synthesized cloud assembly directory',
  }),

  CDK_ASSEMBLY_I0300: info<ContextProviderMessageSource>({
    code: 'CDK_ASSEMBLY_I0300',
    description: 'An info message emitted by a Context Provider',
    interface: 'ContextProviderMessageSource',
  }),
  CDK_ASSEMBLY_I0301: debug<ContextProviderMessageSource>({
    code: 'CDK_ASSEMBLY_I0301',
    description: 'A debug message emitted by a Context Provider',
    interface: 'ContextProviderMessageSource',
  }),

  // Assembly Annotations
  CDK_ASSEMBLY_I9999: info<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_I9999',
    description: 'Annotations emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),
  CDK_ASSEMBLY_W9999: warn<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_W9999',
    description: 'Warnings emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),
  CDK_ASSEMBLY_E9999: error<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_E9999',
    description: 'Errors emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),

  // SDK codes
  CDK_SDK_I0100: trace<SdkTrace>({
    code: 'CDK_SDK_I0100',
    description: 'An SDK trace. SDK traces are emitted as traces to the IoHost, but contain the original SDK logging level.',
    interface: 'SdkTrace',
  }),
  CDK_SDK_I1100: question<MfaTokenRequest>({
    code: 'CDK_SDK_I1100',
    description: 'Get an MFA token for an MFA device.',
    interface: 'MfaTokenRequest',
  }),
};

//////////////////////////////////////////////////////////////////////////////////////////

/**
 * Payload type of the end message must extend Duration
 */
export const SPAN = {
  SYNTH_ASSEMBLY: {
    name: 'Synthesis',
    start: IO.CDK_TOOLKIT_I1001,
    end: IO.CDK_TOOLKIT_I1000,
  },
  DEPLOY_STACK: {
    name: 'Deployment',
    start: IO.CDK_TOOLKIT_I5100,
    end: IO.CDK_TOOLKIT_I5001,
  },
  ROLLBACK_STACK: {
    name: 'Rollback',
    start: IO.CDK_TOOLKIT_I6100,
    end: IO.CDK_TOOLKIT_I6000,
  },
  DIFF_STACK: {
    name: 'Diff',
    start: IO.CDK_TOOLKIT_I4000,
    end: IO.CDK_TOOLKIT_I4001,
  },
  DRIFT_APP: {
    name: 'Drift',
    start: IO.CDK_TOOLKIT_I4000,
    end: IO.CDK_TOOLKIT_I4509,
  },
  DESTROY_STACK: {
    name: 'Destroy',
    start: IO.CDK_TOOLKIT_I7100,
    end: IO.CDK_TOOLKIT_I7001,
  },
  DESTROY_ACTION: {
    name: 'Destroy',
    start: IO.CDK_TOOLKIT_I7101,
    end: IO.CDK_TOOLKIT_I7000,
  },
  BOOTSTRAP_SINGLE: {
    name: 'Bootstrap',
    start: IO.CDK_TOOLKIT_I9100,
    end: IO.CDK_TOOLKIT_I9000,
  },
  BUILD_ASSET: {
    name: 'Build Asset',
    start: IO.CDK_TOOLKIT_I5210,
    end: IO.CDK_TOOLKIT_I5211,
  },
  PUBLISH_ASSET: {
    name: 'Publish Asset',
    start: IO.CDK_TOOLKIT_I5220,
    end: IO.CDK_TOOLKIT_I5221,
  },
  HOTSWAP: {
    name: 'hotswap-deployment',
    start: IO.CDK_TOOLKIT_I5400,
    end: IO.CDK_TOOLKIT_I5410,
  },
} satisfies Record<string, SpanDefinition<any, any>>;
