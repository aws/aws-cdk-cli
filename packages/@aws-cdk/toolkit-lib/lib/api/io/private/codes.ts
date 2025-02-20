import { IoMessageCode, IoMessageLevel } from '../io-message';

export interface CodeInfo {
  code: IoMessageCode;
  description: string;
  level: IoMessageLevel;
  interface?: any;
}

function codeInfo(info: CodeInfo): CodeInfo {
  return info;
}

/**
 * We have a rough system by which we assign message codes:
 * - First digit groups messages by action, e.g. synth or deploy
 * - X000-X009 are reserved for timings
 * - X900-X999 are reserved for results
 */
export const CODES = {
  // 1: Synth
  CDK_TOOLKIT_I1000: codeInfo({
    code: 'CDK_TOOLKIT_I1000',
    description: 'Provides synthesis times.',
    level: 'info',
  }),
  CDK_TOOLKIT_I1901: codeInfo({
    code: 'CDK_TOOLKIT_I1901',
    description: 'Provides stack data',
    level: 'result',
  }),
  CDK_TOOLKIT_I1902: codeInfo({
    code: 'CDK_TOOLKIT_I1902',
    description: 'Successfully deployed stacks',
    level: 'result',
  }),

  // 2: List
  CDK_TOOLKIT_I2901: codeInfo({
    code: 'CDK_TOOLKIT_I2901',
    description: 'Provides details on the selected stacks and their dependencies',
    level: 'result',
  }),

  // 3: Import & Migrate
  CDK_TOOLKIT_E3900: codeInfo({
    code: 'CDK_TOOLKIT_E3900',
    description: 'Resource import failed',
    level: 'error',
  }),

  // 4: Diff

  // 5: Deploy & Watch
  CDK_TOOLKIT_I5000: codeInfo({
    code: 'CDK_TOOLKIT_I5000',
    description: 'Provides deployment times',
    level: 'info',
  }),
  CDK_TOOLKIT_I5001: codeInfo({
    code: 'CDK_TOOLKIT_I5001',
    description: 'Provides total time in deploy action, including synth and rollback',
    level: 'info',
  }),
  CDK_TOOLKIT_I5002: codeInfo({
    code: 'CDK_TOOLKIT_I5002',
    description: 'Provides time for resource migration',
    level: 'info',
  }),
  CDK_TOOLKIT_I5031: codeInfo({
    code: 'CDK_TOOLKIT_I5031',
    description: 'Informs about any log groups that are traced as part of the deployment',
    level: 'info',
  }),
  CDK_TOOLKIT_I5050: codeInfo({
    code: 'CDK_TOOLKIT_I5050',
    description: 'Confirm rollback during deployment',
    level: 'response',
  }),
  CDK_TOOLKIT_I5060: codeInfo({
    code: 'CDK_TOOLKIT_I5060',
    description: 'Confirm deploy security sensitive changes',
    level: 'response',
  }),
  CDK_TOOLKIT_I5900: codeInfo({
    code: 'CDK_TOOLKIT_I5900',
    description: 'Deployment results on success',
    level: 'result',
  }),

  CDK_TOOLKIT_E5001: codeInfo({
    code: 'CDK_TOOLKIT_E5001',
    description: 'No stacks found',
    level: 'error',
  }),

  // 6: Rollback
  CDK_TOOLKIT_I6000: codeInfo({
    code: 'CDK_TOOLKIT_I6000',
    description: 'Provides rollback times',
    level: 'info',
  }),

  CDK_TOOLKIT_E6001: codeInfo({
    code: 'CDK_TOOLKIT_E6001',
    description: 'No stacks found',
    level: 'error',
  }),
  CDK_TOOLKIT_E6900: codeInfo({
    code: 'CDK_TOOLKIT_E6900',
    description: 'Rollback failed',
    level: 'error',
  }),

  // 7: Destroy
  CDK_TOOLKIT_I7000: codeInfo({
    code: 'CDK_TOOLKIT_I7000',
    description: 'Provides destroy times',
    level: 'info',
  }),
  CDK_TOOLKIT_I7010: codeInfo({
    code: 'CDK_TOOLKIT_I7010',
    description: 'Confirm destroy stacks',
    level: 'response',
  }),

  CDK_TOOLKIT_E7010: codeInfo({
    code: 'CDK_TOOLKIT_E7010',
    description: 'Action was aborted due to negative confirmation of request',
    level: 'error',
  }),
  CDK_TOOLKIT_E7900: codeInfo({
    code: 'CDK_TOOLKIT_E7900',
    description: 'Stack deletion failed',
    level: 'error',
  }),

  // 9: Bootstrap

  // Assembly codes
  CDK_ASSEMBLY_I0042: codeInfo({
    code: 'CDK_ASSEMBLY_I0042',
    description: 'Writing updated context',
    level: 'debug',
  }),
  CDK_ASSEMBLY_I0241: codeInfo({
    code: 'CDK_ASSEMBLY_I0241',
    description: 'Fetching missing context',
    level: 'debug',
  }),
  CDK_ASSEMBLY_I1000: codeInfo({
    code: 'CDK_ASSEMBLY_I1000',
    description: 'Cloud assembly output starts',
    level: 'debug',
  }),
  CDK_ASSEMBLY_I1001: codeInfo({
    code: 'CDK_ASSEMBLY_I1001',
    description: 'Output lines emitted by the cloud assembly to stdout',
    level: 'info',
  }),
  CDK_ASSEMBLY_E1002: codeInfo({
    code: 'CDK_ASSEMBLY_E1002',
    description: 'Output lines emitted by the cloud assembly to stderr',
    level: 'error',
  }),
  CDK_ASSEMBLY_I1003: codeInfo({
    code: 'CDK_ASSEMBLY_I1003',
    description: 'Cloud assembly output finished',
    level: 'info',
  }),
  CDK_ASSEMBLY_E1111: codeInfo({
    code: 'CDK_ASSEMBLY_E1111',
    description: 'Incompatible CDK CLI version. Upgrade needed.',
    level: 'error',
  }),
};

// If we give CODES a type with key: IoMessageCode,
// this dynamically generated type will generalize to allow all IoMessageCodes.
// Instead, we will validate that VALID_CODE must be IoMessageCode with the '&'.
export type VALID_CODE = keyof typeof CODES & IoMessageCode;
