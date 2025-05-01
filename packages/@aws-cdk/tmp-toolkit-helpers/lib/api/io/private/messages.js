"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPAN = exports.IO = void 0;
const make = require("./message-maker");
/**
 * We have a rough system by which we assign message codes:
 * - First digit groups messages by action, e.g. synth or deploy
 * - X000-X009 are reserved for timings
 * - X900-X999 are reserved for results
 */
exports.IO = {
    // Defaults (0000)
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
    DEFAULT_TOOLKIT_ERROR: make.error({
        code: 'CDK_TOOLKIT_E0000',
        description: 'Default error messages emitted from the Toolkit',
    }),
    DEFAULT_TOOLKIT_TRACE: make.trace({
        code: 'CDK_TOOLKIT_I0000',
        description: 'Default trace messages emitted from the Toolkit',
    }),
    // warnings & errors
    CDK_TOOLKIT_W0100: make.warn({
        code: 'CDK_TOOLKIT_W0100',
        description: 'Credential plugin warnings',
    }),
    // 1: Synth (1xxx)
    CDK_TOOLKIT_I1000: make.info({
        code: 'CDK_TOOLKIT_I1000',
        description: 'Provides synthesis times.',
        interface: 'Duration',
    }),
    CDK_TOOLKIT_I1001: make.trace({
        code: 'CDK_TOOLKIT_I1001',
        description: 'Cloud Assembly synthesis is starting',
        interface: 'StackSelectionDetails',
    }),
    CDK_TOOLKIT_I1901: make.result({
        code: 'CDK_TOOLKIT_I1901',
        description: 'Provides stack data',
        interface: 'StackAndAssemblyData',
    }),
    CDK_TOOLKIT_I1902: make.result({
        code: 'CDK_TOOLKIT_I1902',
        description: 'Successfully deployed stacks',
        interface: 'AssemblyData',
    }),
    // 2: List (2xxx)
    CDK_TOOLKIT_I2901: make.result({
        code: 'CDK_TOOLKIT_I2901',
        description: 'Provides details on the selected stacks and their dependencies',
        interface: 'StackDetailsPayload',
    }),
    // 3: Import & Migrate
    CDK_TOOLKIT_E3900: make.error({
        code: 'CDK_TOOLKIT_E3900',
        description: 'Resource import failed',
        interface: 'ErrorPayload',
    }),
    // 4: Diff (4xxx)
    CDK_TOOLKIT_I4000: make.trace({
        code: 'CDK_TOOLKIT_I4000',
        description: 'Diff stacks is starting',
        interface: 'StackSelectionDetails',
    }),
    CDK_TOOLKIT_I4001: make.info({
        code: 'CDK_TOOLKIT_I4001',
        description: 'Output of the diff command',
        interface: 'DiffResult',
    }),
    // 5: Deploy & Watch (5xxx)
    CDK_TOOLKIT_I5000: make.info({
        code: 'CDK_TOOLKIT_I5000',
        description: 'Provides deployment times',
        interface: 'Duration',
    }),
    CDK_TOOLKIT_I5001: make.info({
        code: 'CDK_TOOLKIT_I5001',
        description: 'Provides total time in deploy action, including synth and rollback',
        interface: 'Duration',
    }),
    CDK_TOOLKIT_I5002: make.info({
        code: 'CDK_TOOLKIT_I5002',
        description: 'Provides time for resource migration',
        interface: 'Duration',
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
    CDK_TOOLKIT_I5032: make.debug({
        code: 'CDK_TOOLKIT_I5032',
        description: 'Start monitoring log groups',
        interface: 'CloudWatchLogMonitorControlEvent',
    }),
    CDK_TOOLKIT_I5033: make.info({
        code: 'CDK_TOOLKIT_I5033',
        description: 'A log event received from Cloud Watch',
        interface: 'CloudWatchLogEvent',
    }),
    CDK_TOOLKIT_I5034: make.debug({
        code: 'CDK_TOOLKIT_I5034',
        description: 'Stop monitoring log groups',
        interface: 'CloudWatchLogMonitorControlEvent',
    }),
    CDK_TOOLKIT_E5035: make.error({
        code: 'CDK_TOOLKIT_E5035',
        description: 'A log monitoring error',
        interface: 'ErrorPayload',
    }),
    CDK_TOOLKIT_I5050: make.confirm({
        code: 'CDK_TOOLKIT_I5050',
        description: 'Confirm rollback during deployment',
        interface: 'ConfirmationRequest',
    }),
    CDK_TOOLKIT_I5060: make.confirm({
        code: 'CDK_TOOLKIT_I5060',
        description: 'Confirm deploy security sensitive changes',
        interface: 'DeployConfirmationRequest',
    }),
    CDK_TOOLKIT_I5100: make.info({
        code: 'CDK_TOOLKIT_I5100',
        description: 'Stack deploy progress',
        interface: 'StackDeployProgress',
    }),
    // Assets (52xx)
    CDK_TOOLKIT_I5210: make.trace({
        code: 'CDK_TOOLKIT_I5210',
        description: 'Started building a specific asset',
        interface: 'BuildAsset',
    }),
    CDK_TOOLKIT_I5211: make.trace({
        code: 'CDK_TOOLKIT_I5211',
        description: 'Building the asset has completed',
        interface: 'Duration',
    }),
    CDK_TOOLKIT_I5220: make.trace({
        code: 'CDK_TOOLKIT_I5220',
        description: 'Started publishing a specific asset',
        interface: 'PublishAsset',
    }),
    CDK_TOOLKIT_I5221: make.trace({
        code: 'CDK_TOOLKIT_I5221',
        description: 'Publishing the asset has completed',
        interface: 'Duration',
    }),
    // Watch (53xx)
    CDK_TOOLKIT_I5310: make.debug({
        code: 'CDK_TOOLKIT_I5310',
        description: 'The computed settings used for file watching',
        interface: 'WatchSettings',
    }),
    CDK_TOOLKIT_I5311: make.info({
        code: 'CDK_TOOLKIT_I5311',
        description: 'File watching started',
        interface: 'FileWatchEvent',
    }),
    CDK_TOOLKIT_I5312: make.info({
        code: 'CDK_TOOLKIT_I5312',
        description: 'File event detected, starting deployment',
        interface: 'FileWatchEvent',
    }),
    CDK_TOOLKIT_I5313: make.info({
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
    // Hotswap (54xx)
    CDK_TOOLKIT_I5400: make.trace({
        code: 'CDK_TOOLKIT_I5400',
        description: 'Attempting a hotswap deployment',
        interface: 'HotswapDeploymentAttempt',
    }),
    CDK_TOOLKIT_I5401: make.trace({
        code: 'CDK_TOOLKIT_I5401',
        description: 'Computed details for the hotswap deployment',
        interface: 'HotswapDeploymentDetails',
    }),
    CDK_TOOLKIT_I5402: make.info({
        code: 'CDK_TOOLKIT_I5402',
        description: 'A hotswappable change is processed as part of a hotswap deployment',
        interface: 'HotswappableChange',
    }),
    CDK_TOOLKIT_I5403: make.info({
        code: 'CDK_TOOLKIT_I5403',
        description: 'The hotswappable change has completed processing',
        interface: 'HotswappableChange',
    }),
    CDK_TOOLKIT_I5410: make.info({
        code: 'CDK_TOOLKIT_I5410',
        description: 'Hotswap deployment has ended, a full deployment might still follow if needed',
        interface: 'HotswapResult',
    }),
    // Stack Monitor (55xx)
    CDK_TOOLKIT_I5501: make.info({
        code: 'CDK_TOOLKIT_I5501',
        description: 'Stack Monitoring: Start monitoring of a single stack',
        interface: 'StackMonitoringControlEvent',
    }),
    CDK_TOOLKIT_I5502: make.info({
        code: 'CDK_TOOLKIT_I5502',
        description: 'Stack Monitoring: Activity event for a single stack',
        interface: 'StackActivity',
    }),
    CDK_TOOLKIT_I5503: make.info({
        code: 'CDK_TOOLKIT_I5503',
        description: 'Stack Monitoring: Finished monitoring of a single stack',
        interface: 'StackMonitoringControlEvent',
    }),
    // Success (59xx)
    CDK_TOOLKIT_I5900: make.result({
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
    CDK_TOOLKIT_E5001: make.error({
        code: 'CDK_TOOLKIT_E5001',
        description: 'No stacks found',
    }),
    CDK_TOOLKIT_E5500: make.error({
        code: 'CDK_TOOLKIT_E5500',
        description: 'Stack Monitoring error',
        interface: 'ErrorPayload',
    }),
    // 6: Rollback (6xxx)
    CDK_TOOLKIT_I6000: make.info({
        code: 'CDK_TOOLKIT_I6000',
        description: 'Provides rollback times',
        interface: 'Duration',
    }),
    CDK_TOOLKIT_I6100: make.info({
        code: 'CDK_TOOLKIT_I6100',
        description: 'Stack rollback progress',
        interface: 'StackRollbackProgress',
    }),
    CDK_TOOLKIT_E6001: make.error({
        code: 'CDK_TOOLKIT_E6001',
        description: 'No stacks found',
    }),
    CDK_TOOLKIT_E6900: make.error({
        code: 'CDK_TOOLKIT_E6900',
        description: 'Rollback failed',
        interface: 'ErrorPayload',
    }),
    // 7: Destroy (7xxx)
    CDK_TOOLKIT_I7000: make.info({
        code: 'CDK_TOOLKIT_I7000',
        description: 'Provides destroy times',
        interface: 'Duration',
    }),
    CDK_TOOLKIT_I7001: make.trace({
        code: 'CDK_TOOLKIT_I7001',
        description: 'Provides destroy time for a single stack',
        interface: 'Duration',
    }),
    CDK_TOOLKIT_I7010: make.confirm({
        code: 'CDK_TOOLKIT_I7010',
        description: 'Confirm destroy stacks',
        interface: 'ConfirmationRequest',
    }),
    CDK_TOOLKIT_I7100: make.info({
        code: 'CDK_TOOLKIT_I7100',
        description: 'Stack destroy progress',
        interface: 'StackDestroyProgress',
    }),
    CDK_TOOLKIT_I7101: make.trace({
        code: 'CDK_TOOLKIT_I7101',
        description: 'Start stack destroying',
        interface: 'StackDestroy',
    }),
    CDK_TOOLKIT_I7900: make.result({
        code: 'CDK_TOOLKIT_I7900',
        description: 'Stack deletion succeeded',
        interface: 'cxapi.CloudFormationStackArtifact',
    }),
    CDK_TOOLKIT_E7010: make.error({
        code: 'CDK_TOOLKIT_E7010',
        description: 'Action was aborted due to negative confirmation of request',
    }),
    CDK_TOOLKIT_E7900: make.error({
        code: 'CDK_TOOLKIT_E7900',
        description: 'Stack deletion failed',
        interface: 'ErrorPayload',
    }),
    // 8. Refactor (8xxx)
    CDK_TOOLKIT_I8900: make.result({
        code: 'CDK_TOOLKIT_I8900',
        description: 'Refactor result',
        interface: 'RefactorResult',
    }),
    CDK_TOOLKIT_W8010: make.warn({
        code: 'CDK_TOOLKIT_W8010',
        description: 'Refactor execution not yet supported',
    }),
    // 9: Bootstrap (9xxx)
    CDK_TOOLKIT_I9000: make.info({
        code: 'CDK_TOOLKIT_I9000',
        description: 'Provides bootstrap times',
        interface: 'Duration',
    }),
    CDK_TOOLKIT_I9100: make.info({
        code: 'CDK_TOOLKIT_I9100',
        description: 'Bootstrap progress',
        interface: 'BootstrapEnvironmentProgress',
    }),
    CDK_TOOLKIT_I9900: make.result({
        code: 'CDK_TOOLKIT_I9900',
        description: 'Bootstrap results on success',
        interface: 'cxapi.Environment',
    }),
    CDK_TOOLKIT_E9900: make.error({
        code: 'CDK_TOOLKIT_E9900',
        description: 'Bootstrap failed',
        interface: 'ErrorPayload',
    }),
    // Notices
    CDK_TOOLKIT_I0100: make.info({
        code: 'CDK_TOOLKIT_I0100',
        description: 'Notices decoration (the header or footer of a list of notices)',
    }),
    CDK_TOOLKIT_W0101: make.warn({
        code: 'CDK_TOOLKIT_W0101',
        description: 'A notice that is marked as a warning',
    }),
    CDK_TOOLKIT_E0101: make.error({
        code: 'CDK_TOOLKIT_E0101',
        description: 'A notice that is marked as an error',
    }),
    CDK_TOOLKIT_I0101: make.info({
        code: 'CDK_TOOLKIT_I0101',
        description: 'A notice that is marked as informational',
    }),
    // Assembly codes
    DEFAULT_ASSEMBLY_TRACE: make.trace({
        code: 'CDK_ASSEMBLY_I0000',
        description: 'Default trace messages emitted from Cloud Assembly operations',
    }),
    DEFAULT_ASSEMBLY_DEBUG: make.debug({
        code: 'CDK_ASSEMBLY_I0000',
        description: 'Default debug messages emitted from Cloud Assembly operations',
    }),
    DEFAULT_ASSEMBLY_INFO: make.info({
        code: 'CDK_ASSEMBLY_I0000',
        description: 'Default info messages emitted from Cloud Assembly operations',
    }),
    DEFAULT_ASSEMBLY_WARN: make.warn({
        code: 'CDK_ASSEMBLY_W0000',
        description: 'Default warning messages emitted from Cloud Assembly operations',
    }),
    CDK_ASSEMBLY_I0010: make.debug({
        code: 'CDK_ASSEMBLY_I0010',
        description: 'Generic environment preparation debug messages',
    }),
    CDK_ASSEMBLY_W0010: make.warn({
        code: 'CDK_ASSEMBLY_W0010',
        description: 'Emitted if the found framework version does not support context overflow',
    }),
    CDK_ASSEMBLY_I0042: make.debug({
        code: 'CDK_ASSEMBLY_I0042',
        description: 'Writing updated context',
        interface: 'UpdatedContext',
    }),
    CDK_ASSEMBLY_I0240: make.debug({
        code: 'CDK_ASSEMBLY_I0240',
        description: 'Context lookup was stopped as no further progress was made. ',
        interface: 'MissingContext',
    }),
    CDK_ASSEMBLY_I0241: make.debug({
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
    CDK_ASSEMBLY_E1111: make.error({
        code: 'CDK_ASSEMBLY_E1111',
        description: 'Incompatible CDK CLI version. Upgrade needed.',
        interface: 'ErrorPayload',
    }),
    CDK_ASSEMBLY_I0150: make.debug({
        code: 'CDK_ASSEMBLY_I0150',
        description: 'Indicates the use of a pre-synthesized cloud assembly directory',
    }),
    CDK_ASSEMBLY_I0300: make.info({
        code: 'CDK_ASSEMBLY_I0300',
        description: 'An info message emitted by a Context Provider',
        interface: 'ContextProviderMessageSource',
    }),
    CDK_ASSEMBLY_I0301: make.debug({
        code: 'CDK_ASSEMBLY_I0301',
        description: 'A debug message emitted by a Context Provider',
        interface: 'ContextProviderMessageSource',
    }),
    // Assembly Annotations
    CDK_ASSEMBLY_I9999: make.info({
        code: 'CDK_ASSEMBLY_I9999',
        description: 'Annotations emitted by the cloud assembly',
        interface: 'cxapi.SynthesisMessage',
    }),
    CDK_ASSEMBLY_W9999: make.warn({
        code: 'CDK_ASSEMBLY_W9999',
        description: 'Warnings emitted by the cloud assembly',
        interface: 'cxapi.SynthesisMessage',
    }),
    CDK_ASSEMBLY_E9999: make.error({
        code: 'CDK_ASSEMBLY_E9999',
        description: 'Errors emitted by the cloud assembly',
        interface: 'cxapi.SynthesisMessage',
    }),
    // SDK codes
    DEFAULT_SDK_TRACE: make.trace({
        code: 'CDK_SDK_I0000',
        description: 'An SDK trace message.',
    }),
    DEFAULT_SDK_DEBUG: make.debug({
        code: 'CDK_SDK_I0000',
        description: 'An SDK debug message.',
    }),
    DEFAULT_SDK_WARN: make.warn({
        code: 'CDK_SDK_W0000',
        description: 'An SDK warning message.',
    }),
    CDK_SDK_I0100: make.trace({
        code: 'CDK_SDK_I0100',
        description: 'An SDK trace. SDK traces are emitted as traces to the IoHost, but contain the original SDK logging level.',
        interface: 'SdkTrace',
    }),
};
//////////////////////////////////////////////////////////////////////////////////////////
/**
 * Payload type of the end message must extend Duration
 */
exports.SPAN = {
    SYNTH_ASSEMBLY: {
        name: 'Synthesis',
        start: exports.IO.CDK_TOOLKIT_I1001,
        end: exports.IO.CDK_TOOLKIT_I1000,
    },
    DEPLOY_STACK: {
        name: 'Deployment',
        start: exports.IO.CDK_TOOLKIT_I5100,
        end: exports.IO.CDK_TOOLKIT_I5001,
    },
    ROLLBACK_STACK: {
        name: 'Rollback',
        start: exports.IO.CDK_TOOLKIT_I6100,
        end: exports.IO.CDK_TOOLKIT_I6000,
    },
    DIFF_STACK: {
        name: 'Diff',
        start: exports.IO.CDK_TOOLKIT_I4000,
        end: exports.IO.CDK_TOOLKIT_I4001,
    },
    DESTROY_STACK: {
        name: 'Destroy',
        start: exports.IO.CDK_TOOLKIT_I7100,
        end: exports.IO.CDK_TOOLKIT_I7001,
    },
    DESTROY_ACTION: {
        name: 'Destroy',
        start: exports.IO.CDK_TOOLKIT_I7101,
        end: exports.IO.CDK_TOOLKIT_I7000,
    },
    BOOTSTRAP_SINGLE: {
        name: 'Bootstrap',
        start: exports.IO.CDK_TOOLKIT_I9100,
        end: exports.IO.CDK_TOOLKIT_I9000,
    },
    BUILD_ASSET: {
        name: 'Build Asset',
        start: exports.IO.CDK_TOOLKIT_I5210,
        end: exports.IO.CDK_TOOLKIT_I5211,
    },
    PUBLISH_ASSET: {
        name: 'Publish Asset',
        start: exports.IO.CDK_TOOLKIT_I5220,
        end: exports.IO.CDK_TOOLKIT_I5221,
    },
    HOTSWAP: {
        name: 'hotswap-deployment',
        start: exports.IO.CDK_TOOLKIT_I5400,
        end: exports.IO.CDK_TOOLKIT_I5410,
    },
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVzc2FnZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXBpL2lvL3ByaXZhdGUvbWVzc2FnZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0Esd0NBQXdDO0FBa0J4Qzs7Ozs7R0FLRztBQUNVLFFBQUEsRUFBRSxHQUFHO0lBQ2hCLGtCQUFrQjtJQUNsQixvQkFBb0IsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzlCLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLGdEQUFnRDtLQUM5RCxDQUFDO0lBQ0YscUJBQXFCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUNoQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxpREFBaUQ7S0FDL0QsQ0FBQztJQUNGLG9CQUFvQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDOUIsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsbURBQW1EO0tBQ2pFLENBQUM7SUFDRixxQkFBcUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDO1FBQ2hDLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLGlEQUFpRDtLQUMvRCxDQUFDO0lBQ0YscUJBQXFCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUNoQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxpREFBaUQ7S0FDL0QsQ0FBQztJQUVGLG9CQUFvQjtJQUNwQixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzNCLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLDRCQUE0QjtLQUMxQyxDQUFDO0lBRUYsa0JBQWtCO0lBQ2xCLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQVc7UUFDckMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsMkJBQTJCO1FBQ3hDLFNBQVMsRUFBRSxVQUFVO0tBQ3RCLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUF3QjtRQUNuRCxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxzQ0FBc0M7UUFDbkQsU0FBUyxFQUFFLHVCQUF1QjtLQUNuQyxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBdUI7UUFDbkQsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUscUJBQXFCO1FBQ2xDLFNBQVMsRUFBRSxzQkFBc0I7S0FDbEMsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQWU7UUFDM0MsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsOEJBQThCO1FBQzNDLFNBQVMsRUFBRSxjQUFjO0tBQzFCLENBQUM7SUFFRixpQkFBaUI7SUFDakIsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBc0I7UUFDbEQsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsZ0VBQWdFO1FBQzdFLFNBQVMsRUFBRSxxQkFBcUI7S0FDakMsQ0FBQztJQUVGLHNCQUFzQjtJQUN0QixpQkFBaUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFlO1FBQzFDLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLHdCQUF3QjtRQUNyQyxTQUFTLEVBQUUsY0FBYztLQUMxQixDQUFDO0lBRUYsaUJBQWlCO0lBQ2pCLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQXdCO1FBQ25ELElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLHlCQUF5QjtRQUN0QyxTQUFTLEVBQUUsdUJBQXVCO0tBQ25DLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFhO1FBQ3ZDLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLDRCQUE0QjtRQUN6QyxTQUFTLEVBQUUsWUFBWTtLQUN4QixDQUFDO0lBRUYsMkJBQTJCO0lBQzNCLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQVc7UUFDckMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsMkJBQTJCO1FBQ3hDLFNBQVMsRUFBRSxVQUFVO0tBQ3RCLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFXO1FBQ3JDLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLG9FQUFvRTtRQUNqRixTQUFTLEVBQUUsVUFBVTtLQUN0QixDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBVztRQUNyQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxzQ0FBc0M7UUFDbkQsU0FBUyxFQUFFLFVBQVU7S0FDdEIsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDM0IsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsaURBQWlEO0tBQy9ELENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzNCLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLCtDQUErQztLQUM3RCxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQztRQUMzQixJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSx3RUFBd0U7S0FDdEYsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQW1DO1FBQzlELElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLDZCQUE2QjtRQUMxQyxTQUFTLEVBQUUsa0NBQWtDO0tBQzlDLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFxQjtRQUMvQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSx1Q0FBdUM7UUFDcEQsU0FBUyxFQUFFLG9CQUFvQjtLQUNoQyxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBbUM7UUFDOUQsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsNEJBQTRCO1FBQ3pDLFNBQVMsRUFBRSxrQ0FBa0M7S0FDOUMsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQWU7UUFDMUMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsd0JBQXdCO1FBQ3JDLFNBQVMsRUFBRSxjQUFjO0tBQzFCLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFzQjtRQUNuRCxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxvQ0FBb0M7UUFDakQsU0FBUyxFQUFFLHFCQUFxQjtLQUNqQyxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBNEI7UUFDekQsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsMkNBQTJDO1FBQ3hELFNBQVMsRUFBRSwyQkFBMkI7S0FDdkMsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQXNCO1FBQ2hELElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLHVCQUF1QjtRQUNwQyxTQUFTLEVBQUUscUJBQXFCO0tBQ2pDLENBQUM7SUFFRixnQkFBZ0I7SUFDaEIsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBYTtRQUN4QyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxtQ0FBbUM7UUFDaEQsU0FBUyxFQUFFLFlBQVk7S0FDeEIsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQVc7UUFDdEMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsa0NBQWtDO1FBQy9DLFNBQVMsRUFBRSxVQUFVO0tBQ3RCLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFlO1FBQzFDLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLHFDQUFxQztRQUNsRCxTQUFTLEVBQUUsY0FBYztLQUMxQixDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBVztRQUN0QyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxvQ0FBb0M7UUFDakQsU0FBUyxFQUFFLFVBQVU7S0FDdEIsQ0FBQztJQUVGLGVBQWU7SUFDZixpQkFBaUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFnQjtRQUMzQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSw4Q0FBOEM7UUFDM0QsU0FBUyxFQUFFLGVBQWU7S0FDM0IsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQWlCO1FBQzNDLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLHVCQUF1QjtRQUNwQyxTQUFTLEVBQUUsZ0JBQWdCO0tBQzVCLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFpQjtRQUMzQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSwwQ0FBMEM7UUFDdkQsU0FBUyxFQUFFLGdCQUFnQjtLQUM1QixDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBaUI7UUFDM0MsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsa0VBQWtFO1FBQy9FLFNBQVMsRUFBRSxnQkFBZ0I7S0FDNUIsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDM0IsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsa0NBQWtDO0tBQ2hELENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzNCLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLGlDQUFpQztLQUMvQyxDQUFDO0lBRUYsaUJBQWlCO0lBQ2pCLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQTJCO1FBQ3RELElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLGlDQUFpQztRQUM5QyxTQUFTLEVBQUUsMEJBQTBCO0tBQ3RDLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUEyQjtRQUN0RCxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSw2Q0FBNkM7UUFDMUQsU0FBUyxFQUFFLDBCQUEwQjtLQUN0QyxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBcUI7UUFDL0MsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsb0VBQW9FO1FBQ2pGLFNBQVMsRUFBRSxvQkFBb0I7S0FDaEMsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQXFCO1FBQy9DLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLGtEQUFrRDtRQUMvRCxTQUFTLEVBQUUsb0JBQW9CO0tBQ2hDLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFnQjtRQUMxQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSw4RUFBOEU7UUFDM0YsU0FBUyxFQUFFLGVBQWU7S0FDM0IsQ0FBQztJQUVGLHVCQUF1QjtJQUN2QixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUE4QjtRQUN4RCxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxzREFBc0Q7UUFDbkUsU0FBUyxFQUFFLDZCQUE2QjtLQUN6QyxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBZ0I7UUFDMUMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUscURBQXFEO1FBQ2xFLFNBQVMsRUFBRSxlQUFlO0tBQzNCLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUE4QjtRQUN4RCxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSx5REFBeUQ7UUFDdEUsU0FBUyxFQUFFLDZCQUE2QjtLQUN6QyxDQUFDO0lBRUYsaUJBQWlCO0lBQ2pCLGlCQUFpQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQThCO1FBQzFELElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLCtCQUErQjtRQUM1QyxTQUFTLEVBQUUsNkJBQTZCO0tBQ3pDLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzNCLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLHFDQUFxQztLQUNuRCxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQztRQUMzQixJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSw0QkFBNEI7S0FDMUMsQ0FBQztJQUVGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQUM7UUFDNUIsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsaUJBQWlCO0tBQy9CLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFlO1FBQzFDLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLHdCQUF3QjtRQUNyQyxTQUFTLEVBQUUsY0FBYztLQUMxQixDQUFDO0lBRUYscUJBQXFCO0lBQ3JCLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQVc7UUFDckMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUseUJBQXlCO1FBQ3RDLFNBQVMsRUFBRSxVQUFVO0tBQ3RCLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUF3QjtRQUNsRCxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSx5QkFBeUI7UUFDdEMsU0FBUyxFQUFFLHVCQUF1QjtLQUNuQyxDQUFDO0lBRUYsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUM1QixJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxpQkFBaUI7S0FDL0IsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQWU7UUFDMUMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsaUJBQWlCO1FBQzlCLFNBQVMsRUFBRSxjQUFjO0tBQzFCLENBQUM7SUFFRixvQkFBb0I7SUFDcEIsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBVztRQUNyQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSx3QkFBd0I7UUFDckMsU0FBUyxFQUFFLFVBQVU7S0FDdEIsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQVc7UUFDdEMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsMENBQTBDO1FBQ3ZELFNBQVMsRUFBRSxVQUFVO0tBQ3RCLENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFzQjtRQUNuRCxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSx3QkFBd0I7UUFDckMsU0FBUyxFQUFFLHFCQUFxQjtLQUNqQyxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBdUI7UUFDakQsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsd0JBQXdCO1FBQ3JDLFNBQVMsRUFBRSxzQkFBc0I7S0FDbEMsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQWU7UUFDMUMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsd0JBQXdCO1FBQ3JDLFNBQVMsRUFBRSxjQUFjO0tBQzFCLENBQUM7SUFFRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFvQztRQUNoRSxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSwwQkFBMEI7UUFDdkMsU0FBUyxFQUFFLG1DQUFtQztLQUMvQyxDQUFDO0lBRUYsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUM1QixJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSw0REFBNEQ7S0FDMUUsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQWU7UUFDMUMsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsdUJBQXVCO1FBQ3BDLFNBQVMsRUFBRSxjQUFjO0tBQzFCLENBQUM7SUFFRixxQkFBcUI7SUFDckIsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBaUI7UUFDN0MsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsaUJBQWlCO1FBQzlCLFNBQVMsRUFBRSxnQkFBZ0I7S0FDNUIsQ0FBQztJQUVGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDM0IsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUsc0NBQXNDO0tBQ3BELENBQUM7SUFFRixzQkFBc0I7SUFDdEIsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBVztRQUNyQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSwwQkFBMEI7UUFDdkMsU0FBUyxFQUFFLFVBQVU7S0FDdEIsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQStCO1FBQ3pELElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLG9CQUFvQjtRQUNqQyxTQUFTLEVBQUUsOEJBQThCO0tBQzFDLENBQUM7SUFFRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFxQztRQUNqRSxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSw4QkFBOEI7UUFDM0MsU0FBUyxFQUFFLG1CQUFtQjtLQUMvQixDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBZTtRQUMxQyxJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxrQkFBa0I7UUFDL0IsU0FBUyxFQUFFLGNBQWM7S0FDMUIsQ0FBQztJQUVGLFVBQVU7SUFDVixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzNCLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLGdFQUFnRTtLQUM5RSxDQUFDO0lBQ0YsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQztRQUMzQixJQUFJLEVBQUUsbUJBQW1CO1FBQ3pCLFdBQVcsRUFBRSxzQ0FBc0M7S0FDcEQsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQUM7UUFDNUIsSUFBSSxFQUFFLG1CQUFtQjtRQUN6QixXQUFXLEVBQUUscUNBQXFDO0tBQ25ELENBQUM7SUFDRixpQkFBaUIsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzNCLElBQUksRUFBRSxtQkFBbUI7UUFDekIsV0FBVyxFQUFFLDBDQUEwQztLQUN4RCxDQUFDO0lBRUYsaUJBQWlCO0lBQ2pCLHNCQUFzQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQUM7UUFDakMsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixXQUFXLEVBQUUsK0RBQStEO0tBQzdFLENBQUM7SUFDRixzQkFBc0IsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDO1FBQ2pDLElBQUksRUFBRSxvQkFBb0I7UUFDMUIsV0FBVyxFQUFFLCtEQUErRDtLQUM3RSxDQUFDO0lBQ0YscUJBQXFCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQztRQUMvQixJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLFdBQVcsRUFBRSw4REFBOEQ7S0FDNUUsQ0FBQztJQUNGLHFCQUFxQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDL0IsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixXQUFXLEVBQUUsaUVBQWlFO0tBQy9FLENBQUM7SUFFRixrQkFBa0IsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDO1FBQzdCLElBQUksRUFBRSxvQkFBb0I7UUFDMUIsV0FBVyxFQUFFLGdEQUFnRDtLQUM5RCxDQUFDO0lBQ0Ysa0JBQWtCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQztRQUM1QixJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLFdBQVcsRUFBRSwwRUFBMEU7S0FDeEYsQ0FBQztJQUNGLGtCQUFrQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQWlCO1FBQzdDLElBQUksRUFBRSxvQkFBb0I7UUFDMUIsV0FBVyxFQUFFLHlCQUF5QjtRQUN0QyxTQUFTLEVBQUUsZ0JBQWdCO0tBQzVCLENBQUM7SUFDRixrQkFBa0IsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFpQjtRQUM3QyxJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLFdBQVcsRUFBRSw4REFBOEQ7UUFDM0UsU0FBUyxFQUFFLGdCQUFnQjtLQUM1QixDQUFDO0lBQ0Ysa0JBQWtCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBaUI7UUFDN0MsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixXQUFXLEVBQUUsb0hBQW9IO1FBQ2pJLFNBQVMsRUFBRSxnQkFBZ0I7S0FDNUIsQ0FBQztJQUNGLGtCQUFrQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQUM7UUFDN0IsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixXQUFXLEVBQUUsOEJBQThCO0tBQzVDLENBQUM7SUFDRixrQkFBa0IsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQzVCLElBQUksRUFBRSxvQkFBb0I7UUFDMUIsV0FBVyxFQUFFLHNEQUFzRDtLQUNwRSxDQUFDO0lBQ0Ysa0JBQWtCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUM3QixJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLFdBQVcsRUFBRSxzREFBc0Q7S0FDcEUsQ0FBQztJQUNGLGtCQUFrQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDNUIsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixXQUFXLEVBQUUsZ0NBQWdDO0tBQzlDLENBQUM7SUFDRixrQkFBa0IsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFlO1FBQzNDLElBQUksRUFBRSxvQkFBb0I7UUFDMUIsV0FBVyxFQUFFLCtDQUErQztRQUM1RCxTQUFTLEVBQUUsY0FBYztLQUMxQixDQUFDO0lBRUYsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBUTtRQUNwQyxJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLFdBQVcsRUFBRSxpRUFBaUU7S0FDL0UsQ0FBQztJQUVGLGtCQUFrQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQStCO1FBQzFELElBQUksRUFBRSxvQkFBb0I7UUFDMUIsV0FBVyxFQUFFLCtDQUErQztRQUM1RCxTQUFTLEVBQUUsOEJBQThCO0tBQzFDLENBQUM7SUFDRixrQkFBa0IsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUErQjtRQUMzRCxJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLFdBQVcsRUFBRSwrQ0FBK0M7UUFDNUQsU0FBUyxFQUFFLDhCQUE4QjtLQUMxQyxDQUFDO0lBRUYsdUJBQXVCO0lBQ3ZCLGtCQUFrQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQXlCO1FBQ3BELElBQUksRUFBRSxvQkFBb0I7UUFDMUIsV0FBVyxFQUFFLDJDQUEyQztRQUN4RCxTQUFTLEVBQUUsd0JBQXdCO0tBQ3BDLENBQUM7SUFDRixrQkFBa0IsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUF5QjtRQUNwRCxJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLFdBQVcsRUFBRSx3Q0FBd0M7UUFDckQsU0FBUyxFQUFFLHdCQUF3QjtLQUNwQyxDQUFDO0lBQ0Ysa0JBQWtCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBeUI7UUFDckQsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixXQUFXLEVBQUUsc0NBQXNDO1FBQ25ELFNBQVMsRUFBRSx3QkFBd0I7S0FDcEMsQ0FBQztJQUVGLFlBQVk7SUFDWixpQkFBaUIsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDO1FBQzVCLElBQUksRUFBRSxlQUFlO1FBQ3JCLFdBQVcsRUFBRSx1QkFBdUI7S0FDckMsQ0FBQztJQUNGLGlCQUFpQixFQUFFLElBQUksQ0FBQyxLQUFLLENBQUM7UUFDNUIsSUFBSSxFQUFFLGVBQWU7UUFDckIsV0FBVyxFQUFFLHVCQUF1QjtLQUNyQyxDQUFDO0lBQ0YsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQztRQUMxQixJQUFJLEVBQUUsZUFBZTtRQUNyQixXQUFXLEVBQUUseUJBQXlCO0tBQ3ZDLENBQUM7SUFDRixhQUFhLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBVztRQUNsQyxJQUFJLEVBQUUsZUFBZTtRQUNyQixXQUFXLEVBQUUsMkdBQTJHO1FBQ3hILFNBQVMsRUFBRSxVQUFVO0tBQ3RCLENBQUM7Q0FDSCxDQUFDO0FBRUYsMEZBQTBGO0FBRTFGOztHQUVHO0FBQ1UsUUFBQSxJQUFJLEdBQUc7SUFDbEIsY0FBYyxFQUFFO1FBQ2QsSUFBSSxFQUFFLFdBQVc7UUFDakIsS0FBSyxFQUFFLFVBQUUsQ0FBQyxpQkFBaUI7UUFDM0IsR0FBRyxFQUFFLFVBQUUsQ0FBQyxpQkFBaUI7S0FDMUI7SUFDRCxZQUFZLEVBQUU7UUFDWixJQUFJLEVBQUUsWUFBWTtRQUNsQixLQUFLLEVBQUUsVUFBRSxDQUFDLGlCQUFpQjtRQUMzQixHQUFHLEVBQUUsVUFBRSxDQUFDLGlCQUFpQjtLQUMxQjtJQUNELGNBQWMsRUFBRTtRQUNkLElBQUksRUFBRSxVQUFVO1FBQ2hCLEtBQUssRUFBRSxVQUFFLENBQUMsaUJBQWlCO1FBQzNCLEdBQUcsRUFBRSxVQUFFLENBQUMsaUJBQWlCO0tBQzFCO0lBQ0QsVUFBVSxFQUFFO1FBQ1YsSUFBSSxFQUFFLE1BQU07UUFDWixLQUFLLEVBQUUsVUFBRSxDQUFDLGlCQUFpQjtRQUMzQixHQUFHLEVBQUUsVUFBRSxDQUFDLGlCQUFpQjtLQUMxQjtJQUNELGFBQWEsRUFBRTtRQUNiLElBQUksRUFBRSxTQUFTO1FBQ2YsS0FBSyxFQUFFLFVBQUUsQ0FBQyxpQkFBaUI7UUFDM0IsR0FBRyxFQUFFLFVBQUUsQ0FBQyxpQkFBaUI7S0FDMUI7SUFDRCxjQUFjLEVBQUU7UUFDZCxJQUFJLEVBQUUsU0FBUztRQUNmLEtBQUssRUFBRSxVQUFFLENBQUMsaUJBQWlCO1FBQzNCLEdBQUcsRUFBRSxVQUFFLENBQUMsaUJBQWlCO0tBQzFCO0lBQ0QsZ0JBQWdCLEVBQUU7UUFDaEIsSUFBSSxFQUFFLFdBQVc7UUFDakIsS0FBSyxFQUFFLFVBQUUsQ0FBQyxpQkFBaUI7UUFDM0IsR0FBRyxFQUFFLFVBQUUsQ0FBQyxpQkFBaUI7S0FDMUI7SUFDRCxXQUFXLEVBQUU7UUFDWCxJQUFJLEVBQUUsYUFBYTtRQUNuQixLQUFLLEVBQUUsVUFBRSxDQUFDLGlCQUFpQjtRQUMzQixHQUFHLEVBQUUsVUFBRSxDQUFDLGlCQUFpQjtLQUMxQjtJQUNELGFBQWEsRUFBRTtRQUNiLElBQUksRUFBRSxlQUFlO1FBQ3JCLEtBQUssRUFBRSxVQUFFLENBQUMsaUJBQWlCO1FBQzNCLEdBQUcsRUFBRSxVQUFFLENBQUMsaUJBQWlCO0tBQzFCO0lBQ0QsT0FBTyxFQUFFO1FBQ1AsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixLQUFLLEVBQUUsVUFBRSxDQUFDLGlCQUFpQjtRQUMzQixHQUFHLEVBQUUsVUFBRSxDQUFDLGlCQUFpQjtLQUMxQjtDQUNpRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgKiBhcyBjeGFwaSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0ICogYXMgbWFrZSBmcm9tICcuL21lc3NhZ2UtbWFrZXInO1xuaW1wb3J0IHR5cGUgeyBTcGFuRGVmaW5pdGlvbiB9IGZyb20gJy4vc3Bhbic7XG5pbXBvcnQgdHlwZSB7IERpZmZSZXN1bHQgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcyc7XG5pbXBvcnQgdHlwZSB7IEJvb3RzdHJhcEVudmlyb25tZW50UHJvZ3Jlc3MgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcy9ib290c3RyYXAtZW52aXJvbm1lbnQtcHJvZ3Jlc3MnO1xuaW1wb3J0IHR5cGUgeyBNaXNzaW5nQ29udGV4dCwgVXBkYXRlZENvbnRleHQgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcy9jb250ZXh0JztcbmltcG9ydCB0eXBlIHsgQnVpbGRBc3NldCwgRGVwbG95Q29uZmlybWF0aW9uUmVxdWVzdCwgUHVibGlzaEFzc2V0LCBTdGFja0RlcGxveVByb2dyZXNzLCBTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcy9kZXBsb3knO1xuaW1wb3J0IHR5cGUgeyBTdGFja0Rlc3Ryb3ksIFN0YWNrRGVzdHJveVByb2dyZXNzIH0gZnJvbSAnLi4vLi4vLi4vcGF5bG9hZHMvZGVzdHJveSc7XG5pbXBvcnQgdHlwZSB7IEhvdHN3YXBEZXBsb3ltZW50RGV0YWlscywgSG90c3dhcERlcGxveW1lbnRBdHRlbXB0LCBIb3Rzd2FwcGFibGVDaGFuZ2UsIEhvdHN3YXBSZXN1bHQgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcy9ob3Rzd2FwJztcbmltcG9ydCB0eXBlIHsgU3RhY2tEZXRhaWxzUGF5bG9hZCB9IGZyb20gJy4uLy4uLy4uL3BheWxvYWRzL2xpc3QnO1xuaW1wb3J0IHR5cGUgeyBDbG91ZFdhdGNoTG9nRXZlbnQsIENsb3VkV2F0Y2hMb2dNb25pdG9yQ29udHJvbEV2ZW50IH0gZnJvbSAnLi4vLi4vLi4vcGF5bG9hZHMvbG9ncy1tb25pdG9yJztcbmltcG9ydCB0eXBlIHsgUmVmYWN0b3JSZXN1bHQgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcy9yZWZhY3Rvcic7XG5pbXBvcnQgdHlwZSB7IFN0YWNrUm9sbGJhY2tQcm9ncmVzcyB9IGZyb20gJy4uLy4uLy4uL3BheWxvYWRzL3JvbGxiYWNrJztcbmltcG9ydCB0eXBlIHsgU2RrVHJhY2UgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcy9zZGstdHJhY2UnO1xuaW1wb3J0IHR5cGUgeyBTdGFja0FjdGl2aXR5LCBTdGFja01vbml0b3JpbmdDb250cm9sRXZlbnQgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcy9zdGFjay1hY3Rpdml0eSc7XG5pbXBvcnQgdHlwZSB7IFN0YWNrU2VsZWN0aW9uRGV0YWlscyB9IGZyb20gJy4uLy4uLy4uL3BheWxvYWRzL3N5bnRoJztcbmltcG9ydCB0eXBlIHsgQXNzZW1ibHlEYXRhLCBDb25maXJtYXRpb25SZXF1ZXN0LCBDb250ZXh0UHJvdmlkZXJNZXNzYWdlU291cmNlLCBEdXJhdGlvbiwgRXJyb3JQYXlsb2FkLCBTdGFja0FuZEFzc2VtYmx5RGF0YSB9IGZyb20gJy4uLy4uLy4uL3BheWxvYWRzL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgRmlsZVdhdGNoRXZlbnQsIFdhdGNoU2V0dGluZ3MgfSBmcm9tICcuLi8uLi8uLi9wYXlsb2Fkcy93YXRjaCc7XG5cbi8qKlxuICogV2UgaGF2ZSBhIHJvdWdoIHN5c3RlbSBieSB3aGljaCB3ZSBhc3NpZ24gbWVzc2FnZSBjb2RlczpcbiAqIC0gRmlyc3QgZGlnaXQgZ3JvdXBzIG1lc3NhZ2VzIGJ5IGFjdGlvbiwgZS5nLiBzeW50aCBvciBkZXBsb3lcbiAqIC0gWDAwMC1YMDA5IGFyZSByZXNlcnZlZCBmb3IgdGltaW5nc1xuICogLSBYOTAwLVg5OTkgYXJlIHJlc2VydmVkIGZvciByZXN1bHRzXG4gKi9cbmV4cG9ydCBjb25zdCBJTyA9IHtcbiAgLy8gRGVmYXVsdHMgKDAwMDApXG4gIERFRkFVTFRfVE9PTEtJVF9JTkZPOiBtYWtlLmluZm8oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JMDAwMCcsXG4gICAgZGVzY3JpcHRpb246ICdEZWZhdWx0IGluZm8gbWVzc2FnZXMgZW1pdHRlZCBmcm9tIHRoZSBUb29sa2l0JyxcbiAgfSksXG4gIERFRkFVTFRfVE9PTEtJVF9ERUJVRzogbWFrZS5kZWJ1Zyh7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0kwMDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0RlZmF1bHQgZGVidWcgbWVzc2FnZXMgZW1pdHRlZCBmcm9tIHRoZSBUb29sa2l0JyxcbiAgfSksXG4gIERFRkFVTFRfVE9PTEtJVF9XQVJOOiBtYWtlLndhcm4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9XMDAwMCcsXG4gICAgZGVzY3JpcHRpb246ICdEZWZhdWx0IHdhcm5pbmcgbWVzc2FnZXMgZW1pdHRlZCBmcm9tIHRoZSBUb29sa2l0JyxcbiAgfSksXG4gIERFRkFVTFRfVE9PTEtJVF9FUlJPUjogbWFrZS5lcnJvcih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0UwMDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0RlZmF1bHQgZXJyb3IgbWVzc2FnZXMgZW1pdHRlZCBmcm9tIHRoZSBUb29sa2l0JyxcbiAgfSksXG4gIERFRkFVTFRfVE9PTEtJVF9UUkFDRTogbWFrZS50cmFjZSh7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0kwMDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0RlZmF1bHQgdHJhY2UgbWVzc2FnZXMgZW1pdHRlZCBmcm9tIHRoZSBUb29sa2l0JyxcbiAgfSksXG5cbiAgLy8gd2FybmluZ3MgJiBlcnJvcnNcbiAgQ0RLX1RPT0xLSVRfVzAxMDA6IG1ha2Uud2Fybih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX1cwMTAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0NyZWRlbnRpYWwgcGx1Z2luIHdhcm5pbmdzJyxcbiAgfSksXG5cbiAgLy8gMTogU3ludGggKDF4eHgpXG4gIENES19UT09MS0lUX0kxMDAwOiBtYWtlLmluZm88RHVyYXRpb24+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTEwMDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJvdmlkZXMgc3ludGhlc2lzIHRpbWVzLicsXG4gICAgaW50ZXJmYWNlOiAnRHVyYXRpb24nLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTEwMDE6IG1ha2UudHJhY2U8U3RhY2tTZWxlY3Rpb25EZXRhaWxzPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0kxMDAxJyxcbiAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkIEFzc2VtYmx5IHN5bnRoZXNpcyBpcyBzdGFydGluZycsXG4gICAgaW50ZXJmYWNlOiAnU3RhY2tTZWxlY3Rpb25EZXRhaWxzJyxcbiAgfSksXG4gIENES19UT09MS0lUX0kxOTAxOiBtYWtlLnJlc3VsdDxTdGFja0FuZEFzc2VtYmx5RGF0YT4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JMTkwMScsXG4gICAgZGVzY3JpcHRpb246ICdQcm92aWRlcyBzdGFjayBkYXRhJyxcbiAgICBpbnRlcmZhY2U6ICdTdGFja0FuZEFzc2VtYmx5RGF0YScsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JMTkwMjogbWFrZS5yZXN1bHQ8QXNzZW1ibHlEYXRhPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0kxOTAyJyxcbiAgICBkZXNjcmlwdGlvbjogJ1N1Y2Nlc3NmdWxseSBkZXBsb3llZCBzdGFja3MnLFxuICAgIGludGVyZmFjZTogJ0Fzc2VtYmx5RGF0YScsXG4gIH0pLFxuXG4gIC8vIDI6IExpc3QgKDJ4eHgpXG4gIENES19UT09MS0lUX0kyOTAxOiBtYWtlLnJlc3VsdDxTdGFja0RldGFpbHNQYXlsb2FkPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0kyOTAxJyxcbiAgICBkZXNjcmlwdGlvbjogJ1Byb3ZpZGVzIGRldGFpbHMgb24gdGhlIHNlbGVjdGVkIHN0YWNrcyBhbmQgdGhlaXIgZGVwZW5kZW5jaWVzJyxcbiAgICBpbnRlcmZhY2U6ICdTdGFja0RldGFpbHNQYXlsb2FkJyxcbiAgfSksXG5cbiAgLy8gMzogSW1wb3J0ICYgTWlncmF0ZVxuICBDREtfVE9PTEtJVF9FMzkwMDogbWFrZS5lcnJvcjxFcnJvclBheWxvYWQ+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfRTM5MDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnUmVzb3VyY2UgaW1wb3J0IGZhaWxlZCcsXG4gICAgaW50ZXJmYWNlOiAnRXJyb3JQYXlsb2FkJyxcbiAgfSksXG5cbiAgLy8gNDogRGlmZiAoNHh4eClcbiAgQ0RLX1RPT0xLSVRfSTQwMDA6IG1ha2UudHJhY2U8U3RhY2tTZWxlY3Rpb25EZXRhaWxzPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k0MDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0RpZmYgc3RhY2tzIGlzIHN0YXJ0aW5nJyxcbiAgICBpbnRlcmZhY2U6ICdTdGFja1NlbGVjdGlvbkRldGFpbHMnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTQwMDE6IG1ha2UuaW5mbzxEaWZmUmVzdWx0Pih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k0MDAxJyxcbiAgICBkZXNjcmlwdGlvbjogJ091dHB1dCBvZiB0aGUgZGlmZiBjb21tYW5kJyxcbiAgICBpbnRlcmZhY2U6ICdEaWZmUmVzdWx0JyxcbiAgfSksXG5cbiAgLy8gNTogRGVwbG95ICYgV2F0Y2ggKDV4eHgpXG4gIENES19UT09MS0lUX0k1MDAwOiBtYWtlLmluZm88RHVyYXRpb24+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUwMDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJvdmlkZXMgZGVwbG95bWVudCB0aW1lcycsXG4gICAgaW50ZXJmYWNlOiAnRHVyYXRpb24nLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTUwMDE6IG1ha2UuaW5mbzxEdXJhdGlvbj4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTAwMScsXG4gICAgZGVzY3JpcHRpb246ICdQcm92aWRlcyB0b3RhbCB0aW1lIGluIGRlcGxveSBhY3Rpb24sIGluY2x1ZGluZyBzeW50aCBhbmQgcm9sbGJhY2snLFxuICAgIGludGVyZmFjZTogJ0R1cmF0aW9uJyxcbiAgfSksXG4gIENES19UT09MS0lUX0k1MDAyOiBtYWtlLmluZm88RHVyYXRpb24+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUwMDInLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJvdmlkZXMgdGltZSBmb3IgcmVzb3VyY2UgbWlncmF0aW9uJyxcbiAgICBpbnRlcmZhY2U6ICdEdXJhdGlvbicsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9XNTAyMTogbWFrZS53YXJuKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfVzUwMjEnLFxuICAgIGRlc2NyaXB0aW9uOiAnRW1wdHkgbm9uLWV4aXN0ZW50IHN0YWNrLCBkZXBsb3ltZW50IGlzIHNraXBwZWQnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfVzUwMjI6IG1ha2Uud2Fybih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX1c1MDIyJyxcbiAgICBkZXNjcmlwdGlvbjogJ0VtcHR5IGV4aXN0aW5nIHN0YWNrLCBzdGFjayB3aWxsIGJlIGRlc3Ryb3llZCcsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JNTAzMTogbWFrZS5pbmZvKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUwMzEnLFxuICAgIGRlc2NyaXB0aW9uOiAnSW5mb3JtcyBhYm91dCBhbnkgbG9nIGdyb3VwcyB0aGF0IGFyZSB0cmFjZWQgYXMgcGFydCBvZiB0aGUgZGVwbG95bWVudCcsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JNTAzMjogbWFrZS5kZWJ1ZzxDbG91ZFdhdGNoTG9nTW9uaXRvckNvbnRyb2xFdmVudD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTAzMicsXG4gICAgZGVzY3JpcHRpb246ICdTdGFydCBtb25pdG9yaW5nIGxvZyBncm91cHMnLFxuICAgIGludGVyZmFjZTogJ0Nsb3VkV2F0Y2hMb2dNb25pdG9yQ29udHJvbEV2ZW50JyxcbiAgfSksXG4gIENES19UT09MS0lUX0k1MDMzOiBtYWtlLmluZm88Q2xvdWRXYXRjaExvZ0V2ZW50Pih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k1MDMzJyxcbiAgICBkZXNjcmlwdGlvbjogJ0EgbG9nIGV2ZW50IHJlY2VpdmVkIGZyb20gQ2xvdWQgV2F0Y2gnLFxuICAgIGludGVyZmFjZTogJ0Nsb3VkV2F0Y2hMb2dFdmVudCcsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JNTAzNDogbWFrZS5kZWJ1ZzxDbG91ZFdhdGNoTG9nTW9uaXRvckNvbnRyb2xFdmVudD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTAzNCcsXG4gICAgZGVzY3JpcHRpb246ICdTdG9wIG1vbml0b3JpbmcgbG9nIGdyb3VwcycsXG4gICAgaW50ZXJmYWNlOiAnQ2xvdWRXYXRjaExvZ01vbml0b3JDb250cm9sRXZlbnQnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfRTUwMzU6IG1ha2UuZXJyb3I8RXJyb3JQYXlsb2FkPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0U1MDM1JyxcbiAgICBkZXNjcmlwdGlvbjogJ0EgbG9nIG1vbml0b3JpbmcgZXJyb3InLFxuICAgIGludGVyZmFjZTogJ0Vycm9yUGF5bG9hZCcsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JNTA1MDogbWFrZS5jb25maXJtPENvbmZpcm1hdGlvblJlcXVlc3Q+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUwNTAnLFxuICAgIGRlc2NyaXB0aW9uOiAnQ29uZmlybSByb2xsYmFjayBkdXJpbmcgZGVwbG95bWVudCcsXG4gICAgaW50ZXJmYWNlOiAnQ29uZmlybWF0aW9uUmVxdWVzdCcsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JNTA2MDogbWFrZS5jb25maXJtPERlcGxveUNvbmZpcm1hdGlvblJlcXVlc3Q+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUwNjAnLFxuICAgIGRlc2NyaXB0aW9uOiAnQ29uZmlybSBkZXBsb3kgc2VjdXJpdHkgc2Vuc2l0aXZlIGNoYW5nZXMnLFxuICAgIGludGVyZmFjZTogJ0RlcGxveUNvbmZpcm1hdGlvblJlcXVlc3QnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTUxMDA6IG1ha2UuaW5mbzxTdGFja0RlcGxveVByb2dyZXNzPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k1MTAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ1N0YWNrIGRlcGxveSBwcm9ncmVzcycsXG4gICAgaW50ZXJmYWNlOiAnU3RhY2tEZXBsb3lQcm9ncmVzcycsXG4gIH0pLFxuXG4gIC8vIEFzc2V0cyAoNTJ4eClcbiAgQ0RLX1RPT0xLSVRfSTUyMTA6IG1ha2UudHJhY2U8QnVpbGRBc3NldD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTIxMCcsXG4gICAgZGVzY3JpcHRpb246ICdTdGFydGVkIGJ1aWxkaW5nIGEgc3BlY2lmaWMgYXNzZXQnLFxuICAgIGludGVyZmFjZTogJ0J1aWxkQXNzZXQnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTUyMTE6IG1ha2UudHJhY2U8RHVyYXRpb24+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUyMTEnLFxuICAgIGRlc2NyaXB0aW9uOiAnQnVpbGRpbmcgdGhlIGFzc2V0IGhhcyBjb21wbGV0ZWQnLFxuICAgIGludGVyZmFjZTogJ0R1cmF0aW9uJyxcbiAgfSksXG4gIENES19UT09MS0lUX0k1MjIwOiBtYWtlLnRyYWNlPFB1Ymxpc2hBc3NldD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTIyMCcsXG4gICAgZGVzY3JpcHRpb246ICdTdGFydGVkIHB1Ymxpc2hpbmcgYSBzcGVjaWZpYyBhc3NldCcsXG4gICAgaW50ZXJmYWNlOiAnUHVibGlzaEFzc2V0JyxcbiAgfSksXG4gIENES19UT09MS0lUX0k1MjIxOiBtYWtlLnRyYWNlPER1cmF0aW9uPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k1MjIxJyxcbiAgICBkZXNjcmlwdGlvbjogJ1B1Ymxpc2hpbmcgdGhlIGFzc2V0IGhhcyBjb21wbGV0ZWQnLFxuICAgIGludGVyZmFjZTogJ0R1cmF0aW9uJyxcbiAgfSksXG5cbiAgLy8gV2F0Y2ggKDUzeHgpXG4gIENES19UT09MS0lUX0k1MzEwOiBtYWtlLmRlYnVnPFdhdGNoU2V0dGluZ3M+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUzMTAnLFxuICAgIGRlc2NyaXB0aW9uOiAnVGhlIGNvbXB1dGVkIHNldHRpbmdzIHVzZWQgZm9yIGZpbGUgd2F0Y2hpbmcnLFxuICAgIGludGVyZmFjZTogJ1dhdGNoU2V0dGluZ3MnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTUzMTE6IG1ha2UuaW5mbzxGaWxlV2F0Y2hFdmVudD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTMxMScsXG4gICAgZGVzY3JpcHRpb246ICdGaWxlIHdhdGNoaW5nIHN0YXJ0ZWQnLFxuICAgIGludGVyZmFjZTogJ0ZpbGVXYXRjaEV2ZW50JyxcbiAgfSksXG4gIENES19UT09MS0lUX0k1MzEyOiBtYWtlLmluZm88RmlsZVdhdGNoRXZlbnQ+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUzMTInLFxuICAgIGRlc2NyaXB0aW9uOiAnRmlsZSBldmVudCBkZXRlY3RlZCwgc3RhcnRpbmcgZGVwbG95bWVudCcsXG4gICAgaW50ZXJmYWNlOiAnRmlsZVdhdGNoRXZlbnQnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTUzMTM6IG1ha2UuaW5mbzxGaWxlV2F0Y2hFdmVudD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTMxMycsXG4gICAgZGVzY3JpcHRpb246ICdGaWxlIGV2ZW50IGRldGVjdGVkIGR1cmluZyBhY3RpdmUgZGVwbG95bWVudCwgY2hhbmdlcyBhcmUgcXVldWVkJyxcbiAgICBpbnRlcmZhY2U6ICdGaWxlV2F0Y2hFdmVudCcsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JNTMxNDogbWFrZS5pbmZvKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTUzMTQnLFxuICAgIGRlc2NyaXB0aW9uOiAnSW5pdGlhbCB3YXRjaCBkZXBsb3ltZW50IHN0YXJ0ZWQnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTUzMTU6IG1ha2UuaW5mbyh7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k1MzE1JyxcbiAgICBkZXNjcmlwdGlvbjogJ1F1ZXVlZCB3YXRjaCBkZXBsb3ltZW50IHN0YXJ0ZWQnLFxuICB9KSxcblxuICAvLyBIb3Rzd2FwICg1NHh4KVxuICBDREtfVE9PTEtJVF9JNTQwMDogbWFrZS50cmFjZTxIb3Rzd2FwRGVwbG95bWVudEF0dGVtcHQ+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTU0MDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnQXR0ZW1wdGluZyBhIGhvdHN3YXAgZGVwbG95bWVudCcsXG4gICAgaW50ZXJmYWNlOiAnSG90c3dhcERlcGxveW1lbnRBdHRlbXB0JyxcbiAgfSksXG4gIENES19UT09MS0lUX0k1NDAxOiBtYWtlLnRyYWNlPEhvdHN3YXBEZXBsb3ltZW50RGV0YWlscz4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTQwMScsXG4gICAgZGVzY3JpcHRpb246ICdDb21wdXRlZCBkZXRhaWxzIGZvciB0aGUgaG90c3dhcCBkZXBsb3ltZW50JyxcbiAgICBpbnRlcmZhY2U6ICdIb3Rzd2FwRGVwbG95bWVudERldGFpbHMnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTU0MDI6IG1ha2UuaW5mbzxIb3Rzd2FwcGFibGVDaGFuZ2U+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTU0MDInLFxuICAgIGRlc2NyaXB0aW9uOiAnQSBob3Rzd2FwcGFibGUgY2hhbmdlIGlzIHByb2Nlc3NlZCBhcyBwYXJ0IG9mIGEgaG90c3dhcCBkZXBsb3ltZW50JyxcbiAgICBpbnRlcmZhY2U6ICdIb3Rzd2FwcGFibGVDaGFuZ2UnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTU0MDM6IG1ha2UuaW5mbzxIb3Rzd2FwcGFibGVDaGFuZ2U+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTU0MDMnLFxuICAgIGRlc2NyaXB0aW9uOiAnVGhlIGhvdHN3YXBwYWJsZSBjaGFuZ2UgaGFzIGNvbXBsZXRlZCBwcm9jZXNzaW5nJyxcbiAgICBpbnRlcmZhY2U6ICdIb3Rzd2FwcGFibGVDaGFuZ2UnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTU0MTA6IG1ha2UuaW5mbzxIb3Rzd2FwUmVzdWx0Pih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k1NDEwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0hvdHN3YXAgZGVwbG95bWVudCBoYXMgZW5kZWQsIGEgZnVsbCBkZXBsb3ltZW50IG1pZ2h0IHN0aWxsIGZvbGxvdyBpZiBuZWVkZWQnLFxuICAgIGludGVyZmFjZTogJ0hvdHN3YXBSZXN1bHQnLFxuICB9KSxcblxuICAvLyBTdGFjayBNb25pdG9yICg1NXh4KVxuICBDREtfVE9PTEtJVF9JNTUwMTogbWFrZS5pbmZvPFN0YWNrTW9uaXRvcmluZ0NvbnRyb2xFdmVudD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTUwMScsXG4gICAgZGVzY3JpcHRpb246ICdTdGFjayBNb25pdG9yaW5nOiBTdGFydCBtb25pdG9yaW5nIG9mIGEgc2luZ2xlIHN0YWNrJyxcbiAgICBpbnRlcmZhY2U6ICdTdGFja01vbml0b3JpbmdDb250cm9sRXZlbnQnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTU1MDI6IG1ha2UuaW5mbzxTdGFja0FjdGl2aXR5Pih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k1NTAyJyxcbiAgICBkZXNjcmlwdGlvbjogJ1N0YWNrIE1vbml0b3Jpbmc6IEFjdGl2aXR5IGV2ZW50IGZvciBhIHNpbmdsZSBzdGFjaycsXG4gICAgaW50ZXJmYWNlOiAnU3RhY2tBY3Rpdml0eScsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JNTUwMzogbWFrZS5pbmZvPFN0YWNrTW9uaXRvcmluZ0NvbnRyb2xFdmVudD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNTUwMycsXG4gICAgZGVzY3JpcHRpb246ICdTdGFjayBNb25pdG9yaW5nOiBGaW5pc2hlZCBtb25pdG9yaW5nIG9mIGEgc2luZ2xlIHN0YWNrJyxcbiAgICBpbnRlcmZhY2U6ICdTdGFja01vbml0b3JpbmdDb250cm9sRXZlbnQnLFxuICB9KSxcblxuICAvLyBTdWNjZXNzICg1OXh4KVxuICBDREtfVE9PTEtJVF9JNTkwMDogbWFrZS5yZXN1bHQ8U3VjY2Vzc2Z1bERlcGxveVN0YWNrUmVzdWx0Pih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k1OTAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0RlcGxveW1lbnQgcmVzdWx0cyBvbiBzdWNjZXNzJyxcbiAgICBpbnRlcmZhY2U6ICdTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTU5MDE6IG1ha2UuaW5mbyh7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k1OTAxJyxcbiAgICBkZXNjcmlwdGlvbjogJ0dlbmVyaWMgZGVwbG95bWVudCBzdWNjZXNzIG1lc3NhZ2VzJyxcbiAgfSksXG4gIENES19UT09MS0lUX1c1NDAwOiBtYWtlLndhcm4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9XNTQwMCcsXG4gICAgZGVzY3JpcHRpb246ICdIb3Rzd2FwIGRpc2Nsb3N1cmUgbWVzc2FnZScsXG4gIH0pLFxuXG4gIENES19UT09MS0lUX0U1MDAxOiBtYWtlLmVycm9yKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfRTUwMDEnLFxuICAgIGRlc2NyaXB0aW9uOiAnTm8gc3RhY2tzIGZvdW5kJyxcbiAgfSksXG4gIENES19UT09MS0lUX0U1NTAwOiBtYWtlLmVycm9yPEVycm9yUGF5bG9hZD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9FNTUwMCcsXG4gICAgZGVzY3JpcHRpb246ICdTdGFjayBNb25pdG9yaW5nIGVycm9yJyxcbiAgICBpbnRlcmZhY2U6ICdFcnJvclBheWxvYWQnLFxuICB9KSxcblxuICAvLyA2OiBSb2xsYmFjayAoNnh4eClcbiAgQ0RLX1RPT0xLSVRfSTYwMDA6IG1ha2UuaW5mbzxEdXJhdGlvbj4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNjAwMCcsXG4gICAgZGVzY3JpcHRpb246ICdQcm92aWRlcyByb2xsYmFjayB0aW1lcycsXG4gICAgaW50ZXJmYWNlOiAnRHVyYXRpb24nLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTYxMDA6IG1ha2UuaW5mbzxTdGFja1JvbGxiYWNrUHJvZ3Jlc3M+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTYxMDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnU3RhY2sgcm9sbGJhY2sgcHJvZ3Jlc3MnLFxuICAgIGludGVyZmFjZTogJ1N0YWNrUm9sbGJhY2tQcm9ncmVzcycsXG4gIH0pLFxuXG4gIENES19UT09MS0lUX0U2MDAxOiBtYWtlLmVycm9yKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfRTYwMDEnLFxuICAgIGRlc2NyaXB0aW9uOiAnTm8gc3RhY2tzIGZvdW5kJyxcbiAgfSksXG4gIENES19UT09MS0lUX0U2OTAwOiBtYWtlLmVycm9yPEVycm9yUGF5bG9hZD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9FNjkwMCcsXG4gICAgZGVzY3JpcHRpb246ICdSb2xsYmFjayBmYWlsZWQnLFxuICAgIGludGVyZmFjZTogJ0Vycm9yUGF5bG9hZCcsXG4gIH0pLFxuXG4gIC8vIDc6IERlc3Ryb3kgKDd4eHgpXG4gIENES19UT09MS0lUX0k3MDAwOiBtYWtlLmluZm88RHVyYXRpb24+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTcwMDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJvdmlkZXMgZGVzdHJveSB0aW1lcycsXG4gICAgaW50ZXJmYWNlOiAnRHVyYXRpb24nLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTcwMDE6IG1ha2UudHJhY2U8RHVyYXRpb24+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTcwMDEnLFxuICAgIGRlc2NyaXB0aW9uOiAnUHJvdmlkZXMgZGVzdHJveSB0aW1lIGZvciBhIHNpbmdsZSBzdGFjaycsXG4gICAgaW50ZXJmYWNlOiAnRHVyYXRpb24nLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTcwMTA6IG1ha2UuY29uZmlybTxDb25maXJtYXRpb25SZXF1ZXN0Pih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k3MDEwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0NvbmZpcm0gZGVzdHJveSBzdGFja3MnLFxuICAgIGludGVyZmFjZTogJ0NvbmZpcm1hdGlvblJlcXVlc3QnLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTcxMDA6IG1ha2UuaW5mbzxTdGFja0Rlc3Ryb3lQcm9ncmVzcz4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNzEwMCcsXG4gICAgZGVzY3JpcHRpb246ICdTdGFjayBkZXN0cm95IHByb2dyZXNzJyxcbiAgICBpbnRlcmZhY2U6ICdTdGFja0Rlc3Ryb3lQcm9ncmVzcycsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9JNzEwMTogbWFrZS50cmFjZTxTdGFja0Rlc3Ryb3k+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfSTcxMDEnLFxuICAgIGRlc2NyaXB0aW9uOiAnU3RhcnQgc3RhY2sgZGVzdHJveWluZycsXG4gICAgaW50ZXJmYWNlOiAnU3RhY2tEZXN0cm95JyxcbiAgfSksXG5cbiAgQ0RLX1RPT0xLSVRfSTc5MDA6IG1ha2UucmVzdWx0PGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JNzkwMCcsXG4gICAgZGVzY3JpcHRpb246ICdTdGFjayBkZWxldGlvbiBzdWNjZWVkZWQnLFxuICAgIGludGVyZmFjZTogJ2N4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCcsXG4gIH0pLFxuXG4gIENES19UT09MS0lUX0U3MDEwOiBtYWtlLmVycm9yKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfRTcwMTAnLFxuICAgIGRlc2NyaXB0aW9uOiAnQWN0aW9uIHdhcyBhYm9ydGVkIGR1ZSB0byBuZWdhdGl2ZSBjb25maXJtYXRpb24gb2YgcmVxdWVzdCcsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9FNzkwMDogbWFrZS5lcnJvcjxFcnJvclBheWxvYWQ+KHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfRTc5MDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnU3RhY2sgZGVsZXRpb24gZmFpbGVkJyxcbiAgICBpbnRlcmZhY2U6ICdFcnJvclBheWxvYWQnLFxuICB9KSxcblxuICAvLyA4LiBSZWZhY3RvciAoOHh4eClcbiAgQ0RLX1RPT0xLSVRfSTg5MDA6IG1ha2UucmVzdWx0PFJlZmFjdG9yUmVzdWx0Pih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k4OTAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ1JlZmFjdG9yIHJlc3VsdCcsXG4gICAgaW50ZXJmYWNlOiAnUmVmYWN0b3JSZXN1bHQnLFxuICB9KSxcblxuICBDREtfVE9PTEtJVF9XODAxMDogbWFrZS53YXJuKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfVzgwMTAnLFxuICAgIGRlc2NyaXB0aW9uOiAnUmVmYWN0b3IgZXhlY3V0aW9uIG5vdCB5ZXQgc3VwcG9ydGVkJyxcbiAgfSksXG5cbiAgLy8gOTogQm9vdHN0cmFwICg5eHh4KVxuICBDREtfVE9PTEtJVF9JOTAwMDogbWFrZS5pbmZvPER1cmF0aW9uPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k5MDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ1Byb3ZpZGVzIGJvb3RzdHJhcCB0aW1lcycsXG4gICAgaW50ZXJmYWNlOiAnRHVyYXRpb24nLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTkxMDA6IG1ha2UuaW5mbzxCb290c3RyYXBFbnZpcm9ubWVudFByb2dyZXNzPih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k5MTAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0Jvb3RzdHJhcCBwcm9ncmVzcycsXG4gICAgaW50ZXJmYWNlOiAnQm9vdHN0cmFwRW52aXJvbm1lbnRQcm9ncmVzcycsXG4gIH0pLFxuXG4gIENES19UT09MS0lUX0k5OTAwOiBtYWtlLnJlc3VsdDx7IGVudmlyb25tZW50OiBjeGFwaS5FbnZpcm9ubWVudCB9Pih7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0k5OTAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0Jvb3RzdHJhcCByZXN1bHRzIG9uIHN1Y2Nlc3MnLFxuICAgIGludGVyZmFjZTogJ2N4YXBpLkVudmlyb25tZW50JyxcbiAgfSksXG4gIENES19UT09MS0lUX0U5OTAwOiBtYWtlLmVycm9yPEVycm9yUGF5bG9hZD4oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9FOTkwMCcsXG4gICAgZGVzY3JpcHRpb246ICdCb290c3RyYXAgZmFpbGVkJyxcbiAgICBpbnRlcmZhY2U6ICdFcnJvclBheWxvYWQnLFxuICB9KSxcblxuICAvLyBOb3RpY2VzXG4gIENES19UT09MS0lUX0kwMTAwOiBtYWtlLmluZm8oe1xuICAgIGNvZGU6ICdDREtfVE9PTEtJVF9JMDEwMCcsXG4gICAgZGVzY3JpcHRpb246ICdOb3RpY2VzIGRlY29yYXRpb24gKHRoZSBoZWFkZXIgb3IgZm9vdGVyIG9mIGEgbGlzdCBvZiBub3RpY2VzKScsXG4gIH0pLFxuICBDREtfVE9PTEtJVF9XMDEwMTogbWFrZS53YXJuKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfVzAxMDEnLFxuICAgIGRlc2NyaXB0aW9uOiAnQSBub3RpY2UgdGhhdCBpcyBtYXJrZWQgYXMgYSB3YXJuaW5nJyxcbiAgfSksXG4gIENES19UT09MS0lUX0UwMTAxOiBtYWtlLmVycm9yKHtcbiAgICBjb2RlOiAnQ0RLX1RPT0xLSVRfRTAxMDEnLFxuICAgIGRlc2NyaXB0aW9uOiAnQSBub3RpY2UgdGhhdCBpcyBtYXJrZWQgYXMgYW4gZXJyb3InLFxuICB9KSxcbiAgQ0RLX1RPT0xLSVRfSTAxMDE6IG1ha2UuaW5mbyh7XG4gICAgY29kZTogJ0NES19UT09MS0lUX0kwMTAxJyxcbiAgICBkZXNjcmlwdGlvbjogJ0Egbm90aWNlIHRoYXQgaXMgbWFya2VkIGFzIGluZm9ybWF0aW9uYWwnLFxuICB9KSxcblxuICAvLyBBc3NlbWJseSBjb2Rlc1xuICBERUZBVUxUX0FTU0VNQkxZX1RSQUNFOiBtYWtlLnRyYWNlKHtcbiAgICBjb2RlOiAnQ0RLX0FTU0VNQkxZX0kwMDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0RlZmF1bHQgdHJhY2UgbWVzc2FnZXMgZW1pdHRlZCBmcm9tIENsb3VkIEFzc2VtYmx5IG9wZXJhdGlvbnMnLFxuICB9KSxcbiAgREVGQVVMVF9BU1NFTUJMWV9ERUJVRzogbWFrZS5kZWJ1Zyh7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9JMDAwMCcsXG4gICAgZGVzY3JpcHRpb246ICdEZWZhdWx0IGRlYnVnIG1lc3NhZ2VzIGVtaXR0ZWQgZnJvbSBDbG91ZCBBc3NlbWJseSBvcGVyYXRpb25zJyxcbiAgfSksXG4gIERFRkFVTFRfQVNTRU1CTFlfSU5GTzogbWFrZS5pbmZvKHtcbiAgICBjb2RlOiAnQ0RLX0FTU0VNQkxZX0kwMDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0RlZmF1bHQgaW5mbyBtZXNzYWdlcyBlbWl0dGVkIGZyb20gQ2xvdWQgQXNzZW1ibHkgb3BlcmF0aW9ucycsXG4gIH0pLFxuICBERUZBVUxUX0FTU0VNQkxZX1dBUk46IG1ha2Uud2Fybih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9XMDAwMCcsXG4gICAgZGVzY3JpcHRpb246ICdEZWZhdWx0IHdhcm5pbmcgbWVzc2FnZXMgZW1pdHRlZCBmcm9tIENsb3VkIEFzc2VtYmx5IG9wZXJhdGlvbnMnLFxuICB9KSxcblxuICBDREtfQVNTRU1CTFlfSTAwMTA6IG1ha2UuZGVidWcoe1xuICAgIGNvZGU6ICdDREtfQVNTRU1CTFlfSTAwMTAnLFxuICAgIGRlc2NyaXB0aW9uOiAnR2VuZXJpYyBlbnZpcm9ubWVudCBwcmVwYXJhdGlvbiBkZWJ1ZyBtZXNzYWdlcycsXG4gIH0pLFxuICBDREtfQVNTRU1CTFlfVzAwMTA6IG1ha2Uud2Fybih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9XMDAxMCcsXG4gICAgZGVzY3JpcHRpb246ICdFbWl0dGVkIGlmIHRoZSBmb3VuZCBmcmFtZXdvcmsgdmVyc2lvbiBkb2VzIG5vdCBzdXBwb3J0IGNvbnRleHQgb3ZlcmZsb3cnLFxuICB9KSxcbiAgQ0RLX0FTU0VNQkxZX0kwMDQyOiBtYWtlLmRlYnVnPFVwZGF0ZWRDb250ZXh0Pih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9JMDA0MicsXG4gICAgZGVzY3JpcHRpb246ICdXcml0aW5nIHVwZGF0ZWQgY29udGV4dCcsXG4gICAgaW50ZXJmYWNlOiAnVXBkYXRlZENvbnRleHQnLFxuICB9KSxcbiAgQ0RLX0FTU0VNQkxZX0kwMjQwOiBtYWtlLmRlYnVnPE1pc3NpbmdDb250ZXh0Pih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9JMDI0MCcsXG4gICAgZGVzY3JpcHRpb246ICdDb250ZXh0IGxvb2t1cCB3YXMgc3RvcHBlZCBhcyBubyBmdXJ0aGVyIHByb2dyZXNzIHdhcyBtYWRlLiAnLFxuICAgIGludGVyZmFjZTogJ01pc3NpbmdDb250ZXh0JyxcbiAgfSksXG4gIENES19BU1NFTUJMWV9JMDI0MTogbWFrZS5kZWJ1ZzxNaXNzaW5nQ29udGV4dD4oe1xuICAgIGNvZGU6ICdDREtfQVNTRU1CTFlfSTAyNDEnLFxuICAgIGRlc2NyaXB0aW9uOiAnRmV0Y2hpbmcgbWlzc2luZyBjb250ZXh0LiBUaGlzIGlzIGFuIGl0ZXJhdGl2ZSBtZXNzYWdlIHRoYXQgbWF5IGFwcGVhciBtdWx0aXBsZSB0aW1lcyB3aXRoIGRpZmZlcmVudCBtaXNzaW5nIGtleXMuJyxcbiAgICBpbnRlcmZhY2U6ICdNaXNzaW5nQ29udGV4dCcsXG4gIH0pLFxuICBDREtfQVNTRU1CTFlfSTEwMDA6IG1ha2UuZGVidWcoe1xuICAgIGNvZGU6ICdDREtfQVNTRU1CTFlfSTEwMDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWQgYXNzZW1ibHkgb3V0cHV0IHN0YXJ0cycsXG4gIH0pLFxuICBDREtfQVNTRU1CTFlfSTEwMDE6IG1ha2UuaW5mbyh7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9JMTAwMScsXG4gICAgZGVzY3JpcHRpb246ICdPdXRwdXQgbGluZXMgZW1pdHRlZCBieSB0aGUgY2xvdWQgYXNzZW1ibHkgdG8gc3Rkb3V0JyxcbiAgfSksXG4gIENES19BU1NFTUJMWV9FMTAwMjogbWFrZS5lcnJvcih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9FMTAwMicsXG4gICAgZGVzY3JpcHRpb246ICdPdXRwdXQgbGluZXMgZW1pdHRlZCBieSB0aGUgY2xvdWQgYXNzZW1ibHkgdG8gc3RkZXJyJyxcbiAgfSksXG4gIENES19BU1NFTUJMWV9JMTAwMzogbWFrZS5pbmZvKHtcbiAgICBjb2RlOiAnQ0RLX0FTU0VNQkxZX0kxMDAzJyxcbiAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkIGFzc2VtYmx5IG91dHB1dCBmaW5pc2hlZCcsXG4gIH0pLFxuICBDREtfQVNTRU1CTFlfRTExMTE6IG1ha2UuZXJyb3I8RXJyb3JQYXlsb2FkPih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9FMTExMScsXG4gICAgZGVzY3JpcHRpb246ICdJbmNvbXBhdGlibGUgQ0RLIENMSSB2ZXJzaW9uLiBVcGdyYWRlIG5lZWRlZC4nLFxuICAgIGludGVyZmFjZTogJ0Vycm9yUGF5bG9hZCcsXG4gIH0pLFxuXG4gIENES19BU1NFTUJMWV9JMDE1MDogbWFrZS5kZWJ1ZzxuZXZlcj4oe1xuICAgIGNvZGU6ICdDREtfQVNTRU1CTFlfSTAxNTAnLFxuICAgIGRlc2NyaXB0aW9uOiAnSW5kaWNhdGVzIHRoZSB1c2Ugb2YgYSBwcmUtc3ludGhlc2l6ZWQgY2xvdWQgYXNzZW1ibHkgZGlyZWN0b3J5JyxcbiAgfSksXG5cbiAgQ0RLX0FTU0VNQkxZX0kwMzAwOiBtYWtlLmluZm88Q29udGV4dFByb3ZpZGVyTWVzc2FnZVNvdXJjZT4oe1xuICAgIGNvZGU6ICdDREtfQVNTRU1CTFlfSTAzMDAnLFxuICAgIGRlc2NyaXB0aW9uOiAnQW4gaW5mbyBtZXNzYWdlIGVtaXR0ZWQgYnkgYSBDb250ZXh0IFByb3ZpZGVyJyxcbiAgICBpbnRlcmZhY2U6ICdDb250ZXh0UHJvdmlkZXJNZXNzYWdlU291cmNlJyxcbiAgfSksXG4gIENES19BU1NFTUJMWV9JMDMwMTogbWFrZS5kZWJ1ZzxDb250ZXh0UHJvdmlkZXJNZXNzYWdlU291cmNlPih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9JMDMwMScsXG4gICAgZGVzY3JpcHRpb246ICdBIGRlYnVnIG1lc3NhZ2UgZW1pdHRlZCBieSBhIENvbnRleHQgUHJvdmlkZXInLFxuICAgIGludGVyZmFjZTogJ0NvbnRleHRQcm92aWRlck1lc3NhZ2VTb3VyY2UnLFxuICB9KSxcblxuICAvLyBBc3NlbWJseSBBbm5vdGF0aW9uc1xuICBDREtfQVNTRU1CTFlfSTk5OTk6IG1ha2UuaW5mbzxjeGFwaS5TeW50aGVzaXNNZXNzYWdlPih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9JOTk5OScsXG4gICAgZGVzY3JpcHRpb246ICdBbm5vdGF0aW9ucyBlbWl0dGVkIGJ5IHRoZSBjbG91ZCBhc3NlbWJseScsXG4gICAgaW50ZXJmYWNlOiAnY3hhcGkuU3ludGhlc2lzTWVzc2FnZScsXG4gIH0pLFxuICBDREtfQVNTRU1CTFlfVzk5OTk6IG1ha2Uud2FybjxjeGFwaS5TeW50aGVzaXNNZXNzYWdlPih7XG4gICAgY29kZTogJ0NES19BU1NFTUJMWV9XOTk5OScsXG4gICAgZGVzY3JpcHRpb246ICdXYXJuaW5ncyBlbWl0dGVkIGJ5IHRoZSBjbG91ZCBhc3NlbWJseScsXG4gICAgaW50ZXJmYWNlOiAnY3hhcGkuU3ludGhlc2lzTWVzc2FnZScsXG4gIH0pLFxuICBDREtfQVNTRU1CTFlfRTk5OTk6IG1ha2UuZXJyb3I8Y3hhcGkuU3ludGhlc2lzTWVzc2FnZT4oe1xuICAgIGNvZGU6ICdDREtfQVNTRU1CTFlfRTk5OTknLFxuICAgIGRlc2NyaXB0aW9uOiAnRXJyb3JzIGVtaXR0ZWQgYnkgdGhlIGNsb3VkIGFzc2VtYmx5JyxcbiAgICBpbnRlcmZhY2U6ICdjeGFwaS5TeW50aGVzaXNNZXNzYWdlJyxcbiAgfSksXG5cbiAgLy8gU0RLIGNvZGVzXG4gIERFRkFVTFRfU0RLX1RSQUNFOiBtYWtlLnRyYWNlKHtcbiAgICBjb2RlOiAnQ0RLX1NES19JMDAwMCcsXG4gICAgZGVzY3JpcHRpb246ICdBbiBTREsgdHJhY2UgbWVzc2FnZS4nLFxuICB9KSxcbiAgREVGQVVMVF9TREtfREVCVUc6IG1ha2UuZGVidWcoe1xuICAgIGNvZGU6ICdDREtfU0RLX0kwMDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0FuIFNESyBkZWJ1ZyBtZXNzYWdlLicsXG4gIH0pLFxuICBERUZBVUxUX1NES19XQVJOOiBtYWtlLndhcm4oe1xuICAgIGNvZGU6ICdDREtfU0RLX1cwMDAwJyxcbiAgICBkZXNjcmlwdGlvbjogJ0FuIFNESyB3YXJuaW5nIG1lc3NhZ2UuJyxcbiAgfSksXG4gIENES19TREtfSTAxMDA6IG1ha2UudHJhY2U8U2RrVHJhY2U+KHtcbiAgICBjb2RlOiAnQ0RLX1NES19JMDEwMCcsXG4gICAgZGVzY3JpcHRpb246ICdBbiBTREsgdHJhY2UuIFNESyB0cmFjZXMgYXJlIGVtaXR0ZWQgYXMgdHJhY2VzIHRvIHRoZSBJb0hvc3QsIGJ1dCBjb250YWluIHRoZSBvcmlnaW5hbCBTREsgbG9nZ2luZyBsZXZlbC4nLFxuICAgIGludGVyZmFjZTogJ1Nka1RyYWNlJyxcbiAgfSksXG59O1xuXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cblxuLyoqXG4gKiBQYXlsb2FkIHR5cGUgb2YgdGhlIGVuZCBtZXNzYWdlIG11c3QgZXh0ZW5kIER1cmF0aW9uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOID0ge1xuICBTWU5USF9BU1NFTUJMWToge1xuICAgIG5hbWU6ICdTeW50aGVzaXMnLFxuICAgIHN0YXJ0OiBJTy5DREtfVE9PTEtJVF9JMTAwMSxcbiAgICBlbmQ6IElPLkNES19UT09MS0lUX0kxMDAwLFxuICB9LFxuICBERVBMT1lfU1RBQ0s6IHtcbiAgICBuYW1lOiAnRGVwbG95bWVudCcsXG4gICAgc3RhcnQ6IElPLkNES19UT09MS0lUX0k1MTAwLFxuICAgIGVuZDogSU8uQ0RLX1RPT0xLSVRfSTUwMDEsXG4gIH0sXG4gIFJPTExCQUNLX1NUQUNLOiB7XG4gICAgbmFtZTogJ1JvbGxiYWNrJyxcbiAgICBzdGFydDogSU8uQ0RLX1RPT0xLSVRfSTYxMDAsXG4gICAgZW5kOiBJTy5DREtfVE9PTEtJVF9JNjAwMCxcbiAgfSxcbiAgRElGRl9TVEFDSzoge1xuICAgIG5hbWU6ICdEaWZmJyxcbiAgICBzdGFydDogSU8uQ0RLX1RPT0xLSVRfSTQwMDAsXG4gICAgZW5kOiBJTy5DREtfVE9PTEtJVF9JNDAwMSxcbiAgfSxcbiAgREVTVFJPWV9TVEFDSzoge1xuICAgIG5hbWU6ICdEZXN0cm95JyxcbiAgICBzdGFydDogSU8uQ0RLX1RPT0xLSVRfSTcxMDAsXG4gICAgZW5kOiBJTy5DREtfVE9PTEtJVF9JNzAwMSxcbiAgfSxcbiAgREVTVFJPWV9BQ1RJT046IHtcbiAgICBuYW1lOiAnRGVzdHJveScsXG4gICAgc3RhcnQ6IElPLkNES19UT09MS0lUX0k3MTAxLFxuICAgIGVuZDogSU8uQ0RLX1RPT0xLSVRfSTcwMDAsXG4gIH0sXG4gIEJPT1RTVFJBUF9TSU5HTEU6IHtcbiAgICBuYW1lOiAnQm9vdHN0cmFwJyxcbiAgICBzdGFydDogSU8uQ0RLX1RPT0xLSVRfSTkxMDAsXG4gICAgZW5kOiBJTy5DREtfVE9PTEtJVF9JOTAwMCxcbiAgfSxcbiAgQlVJTERfQVNTRVQ6IHtcbiAgICBuYW1lOiAnQnVpbGQgQXNzZXQnLFxuICAgIHN0YXJ0OiBJTy5DREtfVE9PTEtJVF9JNTIxMCxcbiAgICBlbmQ6IElPLkNES19UT09MS0lUX0k1MjExLFxuICB9LFxuICBQVUJMSVNIX0FTU0VUOiB7XG4gICAgbmFtZTogJ1B1Ymxpc2ggQXNzZXQnLFxuICAgIHN0YXJ0OiBJTy5DREtfVE9PTEtJVF9JNTIyMCxcbiAgICBlbmQ6IElPLkNES19UT09MS0lUX0k1MjIxLFxuICB9LFxuICBIT1RTV0FQOiB7XG4gICAgbmFtZTogJ2hvdHN3YXAtZGVwbG95bWVudCcsXG4gICAgc3RhcnQ6IElPLkNES19UT09MS0lUX0k1NDAwLFxuICAgIGVuZDogSU8uQ0RLX1RPT0xLSVRfSTU0MTAsXG4gIH0sXG59IHNhdGlzZmllcyBSZWNvcmQ8c3RyaW5nLCBTcGFuRGVmaW5pdGlvbjxhbnksIGFueT4+O1xuIl19