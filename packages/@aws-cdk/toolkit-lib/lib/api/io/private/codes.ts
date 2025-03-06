import type * as cxapi from '@aws-cdk/cx-api';
import type { SdkTrace } from './sdk-logger';
import type { BootstrapEnvironmentProgress } from '../../../actions/bootstrap';
import type { StackDeployProgress } from '../../../actions/deploy';
import type { StackDestroyProgress } from '../../../actions/destroy';
import type { StackDetailsPayload } from '../../../actions/list';
import type { StackRollbackProgress } from '../../../actions/rollback';
import type { FileWatchEvent, WatchSettings } from '../../../actions/watch';
import type { AssemblyData, ConfirmationRequest, Duration, ErrorPayload, StackAndAssemblyData, SuccessfulDeployStackResult } from '../../../toolkit/types';
import type { StackActivity, StackMonitoringControlEvent } from '../../aws-cdk';
import type { MissingContext, UpdatedContext } from '../../cloud-assembly/context';
import * as make from '../../shared-private';

/**
 * We have a rough system by which we assign message codes:
 * - First digit groups messages by action, e.g. synth or deploy
 * - X000-X009 are reserved for timings
 * - X900-X999 are reserved for results
 */
export const CODES = {
  // Defaults
  DEFAULT_TOOLKIT_INFO: make.info({
    code: 'CDK_TOOLKIT_I0000',
    description: 'Default info messages emitted from the Toolkit',
  }),
  DEFAULT_TOOLKIT_DEBUG: make.debug({
    code: 'CDK_TOOLKIT_I0000',
    description: 'Default debug messages emitted from the Toolkit',
  }),
  DEFAULT_TOOLKIT_WARN: make.warn({
    code: 'CDK_TOOLKIT_W0000',
    description: 'Default warning messages emitted from the Toolkit',
  }),

  // 1: Synth
  CDK_TOOLKIT_I1000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I1000',
    description: 'Provides synthesis times.',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I1901: make.result<StackAndAssemblyData>({
    code: 'CDK_TOOLKIT_I1901',
    description: 'Provides stack data',
    interface: 'StackAndAssemblyData',
  }),
  CDK_TOOLKIT_I1902: make.result<AssemblyData>({
    code: 'CDK_TOOLKIT_I1902',
    description: 'Successfully deployed stacks',
    interface: 'AssemblyData',
  }),

  // 2: List
  CDK_TOOLKIT_I2901: make.result<StackDetailsPayload>({
    code: 'CDK_TOOLKIT_I2901',
    description: 'Provides details on the selected stacks and their dependencies',
    interface: 'StackDetailsPayload',
  }),

  // 3: Import & Migrate
  CDK_TOOLKIT_E3900: make.error({
    code: 'CDK_TOOLKIT_E3900',
    description: 'Resource import failed',
  }),

  // 4: Diff

  // 5: Deploy & Watch
  CDK_TOOLKIT_I5000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I5000',
    description: 'Provides deployment times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I5001: make.info<Duration>({
    code: 'CDK_TOOLKIT_I5001',
    description: 'Provides total time in deploy action, including synth and rollback',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I5002: make.info({
    code: 'CDK_TOOLKIT_I5002',
    description: 'Provides time for resource migration',
  }),
  CDK_TOOLKIT_W5021: make.warn({
    code: 'CDK_TOOLKIT_W5021',
    description: 'Empty non-existent stack, deployment is skipped',
  }),
  CDK_TOOLKIT_W5022: make.warn({
    code: 'CDK_TOOLKIT_W5022',
    description: 'Empty existing stack, stack will be destroyed',
  }),
  CDK_TOOLKIT_I5031: make.info({
    code: 'CDK_TOOLKIT_I5031',
    description: 'Informs about any log groups that are traced as part of the deployment',
  }),
  CDK_TOOLKIT_I5050: make.confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I5050',
    description: 'Confirm rollback during deployment',
    interface: 'ConfirmationRequest',
  }),
  CDK_TOOLKIT_I5060: make.confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I5060',
    description: 'Confirm deploy security sensitive changes',
    interface: 'ConfirmationRequest',
  }),

  CDK_TOOLKIT_I5100: make.info<StackDeployProgress>({
    code: 'CDK_TOOLKIT_I5100',
    description: 'Stack deploy progress',
    interface: 'StackDeployProgress',
  }),

  // Watch
  CDK_TOOLKIT_I5310: make.debug<WatchSettings>({
    code: 'CDK_TOOLKIT_I5310',
    description: 'The computed settings used for file watching',
    interface: 'WatchSettings',
  }),
  CDK_TOOLKIT_I5311: make.info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5311',
    description: 'File watching started',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5312: make.info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5312',
    description: 'File event detected, starting deployment',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5313: make.info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5313',
    description: 'File event detected during active deployment, changes are queued',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5314: make.info({
    code: 'CDK_TOOLKIT_I5314',
    description: 'Initial watch deployment started',
  }),
  CDK_TOOLKIT_I5315: make.info({
    code: 'CDK_TOOLKIT_I5315',
    description: 'Queued watch deployment started',
  }),

  // Stack Monitor
  CDK_TOOLKIT_I5501: make.info<StackMonitoringControlEvent>({
    code: 'CDK_TOOLKIT_I5501',
    description: 'Stack Monitoring: Start monitoring of a single stack',
    interface: 'StackMonitoringControlEvent',
  }),
  CDK_TOOLKIT_I5502: make.info<StackActivity>({
    code: 'CDK_TOOLKIT_I5502',
    description: 'Stack Monitoring: Activity event for a single stack',
    interface: 'StackActivity',
  }),
  CDK_TOOLKIT_I5503: make.info<StackMonitoringControlEvent>({
    code: 'CDK_TOOLKIT_I5503',
    description: 'Stack Monitoring: Finished monitoring of a single stack',
    interface: 'StackMonitoringControlEvent',
  }),

  // Success
  CDK_TOOLKIT_I5900: make.result<SuccessfulDeployStackResult>({
    code: 'CDK_TOOLKIT_I5900',
    description: 'Deployment results on success',
    interface: 'SuccessfulDeployStackResult',
  }),
  CDK_TOOLKIT_I5901: make.info({
    code: 'CDK_TOOLKIT_I5901',
    description: 'Generic deployment success messages',
  }),
  CDK_TOOLKIT_W5400: make.warn({
    code: 'CDK_TOOLKIT_W5400',
    description: 'Hotswap disclosure message',
  }),

  // errors
  CDK_TOOLKIT_E5001: make.error({
    code: 'CDK_TOOLKIT_E5001',
    description: 'No stacks found',
  }),
  CDK_TOOLKIT_E5500: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E5500',
    description: 'Stack Monitoring error',
    interface: 'ErrorPayload',
  }),

  // 6: Rollback
  CDK_TOOLKIT_I6000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I6000',
    description: 'Provides rollback times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I6100: make.info<StackRollbackProgress>({
    code: 'CDK_TOOLKIT_I6100',
    description: 'Stack rollback progress',
    interface: 'StackRollbackProgress',
  }),

  CDK_TOOLKIT_E6001: make.error({
    code: 'CDK_TOOLKIT_E6001',
    description: 'No stacks found',
  }),
  CDK_TOOLKIT_E6900: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E6900',
    description: 'Rollback failed',
    interface: 'ErrorPayload',
  }),

  // 7: Destroy
  CDK_TOOLKIT_I7000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I7000',
    description: 'Provides destroy times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I7010: make.confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I7010',
    description: 'Confirm destroy stacks',
    interface: 'ConfirmationRequest',
  }),
  CDK_TOOLKIT_I7100: make.info<StackDestroyProgress>({
    code: 'CDK_TOOLKIT_I7100',
    description: 'Stack destroy progress',
    interface: 'StackDestroyProgress',
  }),

  CDK_TOOLKIT_I7900: make.result<cxapi.CloudFormationStackArtifact>({
    code: 'CDK_TOOLKIT_I7900',
    description: 'Stack deletion succeeded',
    interface: 'cxapi.CloudFormationStackArtifact',
  }),

  CDK_TOOLKIT_E7010: make.error({
    code: 'CDK_TOOLKIT_E7010',
    description: 'Action was aborted due to negative confirmation of request',
  }),
  CDK_TOOLKIT_E7900: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E7900',
    description: 'Stack deletion failed',
    interface: 'ErrorPayload',
  }),

  // 9: Bootstrap
  CDK_TOOLKIT_I9000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I9000',
    description: 'Provides bootstrap times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I9100: make.info<BootstrapEnvironmentProgress>({
    code: 'CDK_TOOLKIT_I9100',
    description: 'Bootstrap progress',
    interface: 'BootstrapEnvironmentProgress',
  }),

  CDK_TOOLKIT_I9900: make.result<{ environment: cxapi.Environment }>({
    code: 'CDK_TOOLKIT_I9900',
    description: 'Bootstrap results on success',
    interface: 'cxapi.Environment',
  }),
  CDK_TOOLKIT_E9900: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E9900',
    description: 'Bootstrap failed',
    interface: 'ErrorPayload',
  }),

  // Assembly codes
  CDK_ASSEMBLY_I0010: make.debug({
    code: 'CDK_ASSEMBLY_I0010',
    description: 'Generic environment preparation debug messages',
  }),
  CDK_ASSEMBLY_W0010: make.warn({
    code: 'CDK_ASSEMBLY_W0010',
    description: 'Emitted if the found framework version does not support context overflow',
  }),
  CDK_ASSEMBLY_I0042: make.debug<UpdatedContext>({
    code: 'CDK_ASSEMBLY_I0042',
    description: 'Writing updated context',
    interface: 'UpdatedContext',
  }),
  CDK_ASSEMBLY_I0240: make.debug<MissingContext>({
    code: 'CDK_ASSEMBLY_I0240',
    description: 'Context lookup was stopped as no further progress was made. ',
    interface: 'MissingContext',
  }),
  CDK_ASSEMBLY_I0241: make.debug<MissingContext>({
    code: 'CDK_ASSEMBLY_I0241',
    description: 'Fetching missing context. This is an iterative message that may appear multiple times with different missing keys.',
    interface: 'MissingContext',
  }),
  CDK_ASSEMBLY_I1000: make.debug({
    code: 'CDK_ASSEMBLY_I1000',
    description: 'Cloud assembly output starts',
  }),
  CDK_ASSEMBLY_I1001: make.info({
    code: 'CDK_ASSEMBLY_I1001',
    description: 'Output lines emitted by the cloud assembly to stdout',
  }),
  CDK_ASSEMBLY_E1002: make.error({
    code: 'CDK_ASSEMBLY_E1002',
    description: 'Output lines emitted by the cloud assembly to stderr',
  }),
  CDK_ASSEMBLY_I1003: make.info({
    code: 'CDK_ASSEMBLY_I1003',
    description: 'Cloud assembly output finished',
  }),
  CDK_ASSEMBLY_E1111: make.error<ErrorPayload>({
    code: 'CDK_ASSEMBLY_E1111',
    description: 'Incompatible CDK CLI version. Upgrade needed.',
    interface: 'ErrorPayload',
  }),

  CDK_ASSEMBLY_I0150: make.debug<never>({
    code: 'CDK_ASSEMBLY_I0150',
    description: 'Indicates the use of a pre-synthesized cloud assembly directory',
  }),

  // Assembly Annotations
  CDK_ASSEMBLY_I9999: make.info<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_I9999',
    description: 'Annotations emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),
  CDK_ASSEMBLY_W9999: make.warn<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_W9999',
    description: 'Warnings emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),
  CDK_ASSEMBLY_E9999: make.error<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_E9999',
    description: 'Errors emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),

  // SDK codes
  CDK_SDK_I0100: make.trace<SdkTrace>({
    code: 'CDK_SDK_I0100',
    description: 'An SDK trace. SDK traces are emitted as traces to the IoHost, but contain the original SDK logging level.',
    interface: 'SdkTrace',
  }),
};
