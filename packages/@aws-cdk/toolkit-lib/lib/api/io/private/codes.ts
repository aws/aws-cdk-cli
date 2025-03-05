import { StackDetailsPayload } from '../../../actions/list';
import { AssemblyData, Duration, ErrorPayload, StackAndAssemblyData } from '../../../toolkit/types';
import { StackActivity, StackMonitoringControlEvent } from '../../aws-cdk';
import { MissingContext, UpdatedContext } from '../../cloud-assembly/context';
import * as make from '../../shared-private';

/**
 * We have a rough system by which we assign message codes:
 * - First digit groups messages by action, e.g. synth or deploy
 * - X000-X009 are reserved for timings
 * - X900-X999 are reserved for results
 */
export const CODES = {
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
  CDK_TOOLKIT_I5031: make.info({
    code: 'CDK_TOOLKIT_I5031',
    description: 'Informs about any log groups that are traced as part of the deployment',
  }),
  CDK_TOOLKIT_I5050: make.info({
    code: 'CDK_TOOLKIT_I5050',
    description: 'Confirm rollback during deployment',
  }),
  CDK_TOOLKIT_I5060: make.info({
    code: 'CDK_TOOLKIT_I5060',
    description: 'Confirm deploy security sensitive changes, depending on approval level',
  }),

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

  CDK_TOOLKIT_I5900: make.result({
    code: 'CDK_TOOLKIT_I5900',
    description: 'Deployment results on success',
    interface: 'SuccessfulDeployStackResult',
  }),

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

  CDK_TOOLKIT_E6001: make.error({
    code: 'CDK_TOOLKIT_E6001',
    description: 'No stacks found',
  }),
  CDK_TOOLKIT_E6900: make.error({
    code: 'CDK_TOOLKIT_E6900',
    description: 'Rollback failed',
  }),

  // 7: Destroy
  CDK_TOOLKIT_I7000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I7000',
    description: 'Provides destroy times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I7010: make.info({
    code: 'CDK_TOOLKIT_I7010',
    description: 'Confirm destroy stacks',
  }),

  CDK_TOOLKIT_E7010: make.error({
    code: 'CDK_TOOLKIT_E7010',
    description: 'Action was aborted due to negative confirmation of request',
  }),
  CDK_TOOLKIT_E7900: make.error({
    code: 'CDK_TOOLKIT_E7900',
    description: 'Stack deletion failed',
  }),

  // 9: Bootstrap
  CDK_TOOLKIT_I9000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I9000',
    description: 'Provides bootstrap times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I9900: make.info({
    code: 'CDK_TOOLKIT_I9900',
    description: 'Bootstrap results on success',
  }),
  CDK_TOOLKIT_E9900: make.error({
    code: 'CDK_TOOLKIT_E9900',
    description: 'Bootstrap failed',
  }),

  // Assembly codes
  CDK_ASSEMBLY_I0042: make.debug<UpdatedContext>({
    code: 'CDK_ASSEMBLY_I0042',
    description: 'Writing updated context',
    interface: 'UpdatedContext',
  }),
  CDK_ASSEMBLY_I0241: make.debug<MissingContext>({
    code: 'CDK_ASSEMBLY_I0241',
    description: 'Fetching missing context',
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
};
