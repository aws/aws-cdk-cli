import type * as cxapi from '@aws-cdk/cx-api';
import * as make from './message-maker';
import type { DiffResult } from '../../../payloads';
import type { BootstrapEnvironmentProgress } from '../../../payloads/bootstrap-environment-progress';
import type { MissingContext, UpdatedContext } from '../../../payloads/context';
import type { BuildAsset, DeployConfirmationRequest, PublishAsset, StackDeployProgress, SuccessfulDeployStackResult } from '../../../payloads/deploy';
import type { StackDestroy, StackDestroyProgress } from '../../../payloads/destroy';
import type { HotswapDeploymentDetails, HotswapDeploymentAttempt, HotswappableChange, HotswapResult } from '../../../payloads/hotswap';
import type { StackDetailsPayload } from '../../../payloads/list';
import type { CloudWatchLogEvent, CloudWatchLogMonitorControlEvent } from '../../../payloads/logs-monitor';
import type { RefactorResult } from '../../../payloads/refactor';
import type { StackRollbackProgress } from '../../../payloads/rollback';
import type { SdkTrace } from '../../../payloads/sdk-trace';
import type { StackActivity, StackMonitoringControlEvent } from '../../../payloads/stack-activity';
import type { StackSelectionDetails } from '../../../payloads/synth';
import type { AssemblyData, ConfirmationRequest, ContextProviderMessageSource, Duration, ErrorPayload, StackAndAssemblyData } from '../../../payloads/types';
import type { FileWatchEvent, WatchSettings } from '../../../payloads/watch';
/**
 * We have a rough system by which we assign message codes:
 * - First digit groups messages by action, e.g. synth or deploy
 * - X000-X009 are reserved for timings
 * - X900-X999 are reserved for results
 */
export declare const IO: {
    DEFAULT_TOOLKIT_INFO: make.IoMessageMaker<void>;
    DEFAULT_TOOLKIT_DEBUG: make.IoMessageMaker<void>;
    DEFAULT_TOOLKIT_WARN: make.IoMessageMaker<void>;
    DEFAULT_TOOLKIT_ERROR: make.IoMessageMaker<void>;
    DEFAULT_TOOLKIT_TRACE: make.IoMessageMaker<void>;
    CDK_TOOLKIT_W0100: make.IoMessageMaker<void>;
    CDK_TOOLKIT_I1000: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I1001: make.IoMessageMaker<StackSelectionDetails>;
    CDK_TOOLKIT_I1901: make.IoMessageMaker<StackAndAssemblyData>;
    CDK_TOOLKIT_I1902: make.IoMessageMaker<AssemblyData>;
    CDK_TOOLKIT_I2901: make.IoMessageMaker<StackDetailsPayload>;
    CDK_TOOLKIT_E3900: make.IoMessageMaker<ErrorPayload>;
    CDK_TOOLKIT_I4000: make.IoMessageMaker<StackSelectionDetails>;
    CDK_TOOLKIT_I4001: make.IoMessageMaker<DiffResult>;
    CDK_TOOLKIT_I5000: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I5001: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I5002: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_W5021: make.IoMessageMaker<void>;
    CDK_TOOLKIT_W5022: make.IoMessageMaker<void>;
    CDK_TOOLKIT_I5031: make.IoMessageMaker<void>;
    CDK_TOOLKIT_I5032: make.IoMessageMaker<CloudWatchLogMonitorControlEvent>;
    CDK_TOOLKIT_I5033: make.IoMessageMaker<CloudWatchLogEvent>;
    CDK_TOOLKIT_I5034: make.IoMessageMaker<CloudWatchLogMonitorControlEvent>;
    CDK_TOOLKIT_E5035: make.IoMessageMaker<ErrorPayload>;
    CDK_TOOLKIT_I5050: make.IoRequestMaker<ConfirmationRequest, boolean>;
    CDK_TOOLKIT_I5060: make.IoRequestMaker<DeployConfirmationRequest, boolean>;
    CDK_TOOLKIT_I5100: make.IoMessageMaker<StackDeployProgress>;
    CDK_TOOLKIT_I5210: make.IoMessageMaker<BuildAsset>;
    CDK_TOOLKIT_I5211: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I5220: make.IoMessageMaker<PublishAsset>;
    CDK_TOOLKIT_I5221: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I5310: make.IoMessageMaker<WatchSettings>;
    CDK_TOOLKIT_I5311: make.IoMessageMaker<FileWatchEvent>;
    CDK_TOOLKIT_I5312: make.IoMessageMaker<FileWatchEvent>;
    CDK_TOOLKIT_I5313: make.IoMessageMaker<FileWatchEvent>;
    CDK_TOOLKIT_I5314: make.IoMessageMaker<void>;
    CDK_TOOLKIT_I5315: make.IoMessageMaker<void>;
    CDK_TOOLKIT_I5400: make.IoMessageMaker<HotswapDeploymentAttempt>;
    CDK_TOOLKIT_I5401: make.IoMessageMaker<HotswapDeploymentDetails>;
    CDK_TOOLKIT_I5402: make.IoMessageMaker<HotswappableChange>;
    CDK_TOOLKIT_I5403: make.IoMessageMaker<HotswappableChange>;
    CDK_TOOLKIT_I5410: make.IoMessageMaker<HotswapResult>;
    CDK_TOOLKIT_I5501: make.IoMessageMaker<StackMonitoringControlEvent>;
    CDK_TOOLKIT_I5502: make.IoMessageMaker<StackActivity>;
    CDK_TOOLKIT_I5503: make.IoMessageMaker<StackMonitoringControlEvent>;
    CDK_TOOLKIT_I5900: make.IoMessageMaker<SuccessfulDeployStackResult>;
    CDK_TOOLKIT_I5901: make.IoMessageMaker<void>;
    CDK_TOOLKIT_W5400: make.IoMessageMaker<void>;
    CDK_TOOLKIT_E5001: make.IoMessageMaker<void>;
    CDK_TOOLKIT_E5500: make.IoMessageMaker<ErrorPayload>;
    CDK_TOOLKIT_I6000: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I6100: make.IoMessageMaker<StackRollbackProgress>;
    CDK_TOOLKIT_E6001: make.IoMessageMaker<void>;
    CDK_TOOLKIT_E6900: make.IoMessageMaker<ErrorPayload>;
    CDK_TOOLKIT_I7000: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I7001: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I7010: make.IoRequestMaker<ConfirmationRequest, boolean>;
    CDK_TOOLKIT_I7100: make.IoMessageMaker<StackDestroyProgress>;
    CDK_TOOLKIT_I7101: make.IoMessageMaker<StackDestroy>;
    CDK_TOOLKIT_I7900: make.IoMessageMaker<cxapi.CloudFormationStackArtifact>;
    CDK_TOOLKIT_E7010: make.IoMessageMaker<void>;
    CDK_TOOLKIT_E7900: make.IoMessageMaker<ErrorPayload>;
    CDK_TOOLKIT_I8900: make.IoMessageMaker<RefactorResult>;
    CDK_TOOLKIT_W8010: make.IoMessageMaker<void>;
    CDK_TOOLKIT_I9000: make.IoMessageMaker<Duration>;
    CDK_TOOLKIT_I9100: make.IoMessageMaker<BootstrapEnvironmentProgress>;
    CDK_TOOLKIT_I9900: make.IoMessageMaker<{
        environment: cxapi.Environment;
    }>;
    CDK_TOOLKIT_E9900: make.IoMessageMaker<ErrorPayload>;
    CDK_TOOLKIT_I0100: make.IoMessageMaker<void>;
    CDK_TOOLKIT_W0101: make.IoMessageMaker<void>;
    CDK_TOOLKIT_E0101: make.IoMessageMaker<void>;
    CDK_TOOLKIT_I0101: make.IoMessageMaker<void>;
    DEFAULT_ASSEMBLY_TRACE: make.IoMessageMaker<void>;
    DEFAULT_ASSEMBLY_DEBUG: make.IoMessageMaker<void>;
    DEFAULT_ASSEMBLY_INFO: make.IoMessageMaker<void>;
    DEFAULT_ASSEMBLY_WARN: make.IoMessageMaker<void>;
    CDK_ASSEMBLY_I0010: make.IoMessageMaker<void>;
    CDK_ASSEMBLY_W0010: make.IoMessageMaker<void>;
    CDK_ASSEMBLY_I0042: make.IoMessageMaker<UpdatedContext>;
    CDK_ASSEMBLY_I0240: make.IoMessageMaker<MissingContext>;
    CDK_ASSEMBLY_I0241: make.IoMessageMaker<MissingContext>;
    CDK_ASSEMBLY_I1000: make.IoMessageMaker<void>;
    CDK_ASSEMBLY_I1001: make.IoMessageMaker<void>;
    CDK_ASSEMBLY_E1002: make.IoMessageMaker<void>;
    CDK_ASSEMBLY_I1003: make.IoMessageMaker<void>;
    CDK_ASSEMBLY_E1111: make.IoMessageMaker<ErrorPayload>;
    CDK_ASSEMBLY_I0150: make.IoMessageMaker<never>;
    CDK_ASSEMBLY_I0300: make.IoMessageMaker<ContextProviderMessageSource>;
    CDK_ASSEMBLY_I0301: make.IoMessageMaker<ContextProviderMessageSource>;
    CDK_ASSEMBLY_I9999: make.IoMessageMaker<cxapi.SynthesisMessage>;
    CDK_ASSEMBLY_W9999: make.IoMessageMaker<cxapi.SynthesisMessage>;
    CDK_ASSEMBLY_E9999: make.IoMessageMaker<cxapi.SynthesisMessage>;
    DEFAULT_SDK_TRACE: make.IoMessageMaker<void>;
    DEFAULT_SDK_DEBUG: make.IoMessageMaker<void>;
    DEFAULT_SDK_WARN: make.IoMessageMaker<void>;
    CDK_SDK_I0100: make.IoMessageMaker<SdkTrace>;
};
/**
 * Payload type of the end message must extend Duration
 */
export declare const SPAN: {
    SYNTH_ASSEMBLY: {
        name: string;
        start: make.IoMessageMaker<StackSelectionDetails>;
        end: make.IoMessageMaker<Duration>;
    };
    DEPLOY_STACK: {
        name: string;
        start: make.IoMessageMaker<StackDeployProgress>;
        end: make.IoMessageMaker<Duration>;
    };
    ROLLBACK_STACK: {
        name: string;
        start: make.IoMessageMaker<StackRollbackProgress>;
        end: make.IoMessageMaker<Duration>;
    };
    DIFF_STACK: {
        name: string;
        start: make.IoMessageMaker<StackSelectionDetails>;
        end: make.IoMessageMaker<DiffResult>;
    };
    DESTROY_STACK: {
        name: string;
        start: make.IoMessageMaker<StackDestroyProgress>;
        end: make.IoMessageMaker<Duration>;
    };
    DESTROY_ACTION: {
        name: string;
        start: make.IoMessageMaker<StackDestroy>;
        end: make.IoMessageMaker<Duration>;
    };
    BOOTSTRAP_SINGLE: {
        name: string;
        start: make.IoMessageMaker<BootstrapEnvironmentProgress>;
        end: make.IoMessageMaker<Duration>;
    };
    BUILD_ASSET: {
        name: string;
        start: make.IoMessageMaker<BuildAsset>;
        end: make.IoMessageMaker<Duration>;
    };
    PUBLISH_ASSET: {
        name: string;
        start: make.IoMessageMaker<PublishAsset>;
        end: make.IoMessageMaker<Duration>;
    };
    HOTSWAP: {
        name: string;
        start: make.IoMessageMaker<HotswapDeploymentAttempt>;
        end: make.IoMessageMaker<HotswapResult>;
    };
};
