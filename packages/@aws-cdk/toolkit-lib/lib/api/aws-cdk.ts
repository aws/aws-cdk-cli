/* eslint-disable import/no-restricted-paths */

// APIs
export { SdkProvider } from '../../../../aws-cdk/lib/api/aws-auth';
export { Context, PROJECT_CONTEXT } from '../../../../aws-cdk/lib/api/context';
export { Deployments, type SuccessfulDeployStackResult, type DeployStackOptions, type DeployStackResult } from '../../../../aws-cdk/lib/api/deployments';
export { Settings } from '../../../../aws-cdk/lib/api/settings';
export { type Tag, tagsForStack } from '../../../../aws-cdk/lib/api/tags';
export { DEFAULT_TOOLKIT_STACK_NAME } from '../../../../aws-cdk/lib/api/toolkit-info';
export { ResourceMigrator } from '../../../../aws-cdk/lib/api/resource-import';
export { CloudWatchLogEventMonitor, findCloudWatchLogGroups } from '../../../../aws-cdk/lib/api/logs';
export { type WorkGraph, WorkGraphBuilder, AssetBuildNode, AssetPublishNode, StackNode, Concurrency } from '../../../../aws-cdk/lib/api/work-graph';
export { Bootstrapper } from '../../../../aws-cdk/lib/api/bootstrap';

// Context Providers
export * as contextproviders from '../../../../aws-cdk/lib/context-providers';

// @todo APIs not clean import
export { HotswapMode } from '../../../../aws-cdk/lib/api/hotswap/common';
export { HotswapPropertyOverrides, EcsHotswapProperties } from '../../../../aws-cdk/lib/api/hotswap/common';
export { RWLock, type ILock } from '../../../../aws-cdk/lib/api/util/rwlock';

// @todo Not yet API probably should be
export { loadTree, some } from '../../../../aws-cdk/lib/tree';

// @todo Cloud Assembly and Executable - this is a messy API right now
export { CloudAssembly, sanitizePatterns, StackCollection, ExtendedStackSelection } from '../../../../aws-cdk/lib/api/cxapp/cloud-assembly';
export { prepareDefaultEnvironment, prepareContext, spaceAvailableForContext } from '../../../../aws-cdk/lib/api/cxapp/exec';
export { guessExecutable } from '../../../../aws-cdk/lib/api/cxapp/exec';

// @todo Should not use! investigate how to replace
export { versionNumber } from '../../../../aws-cdk/lib/cli/version';
export { CliIoHost } from '../../../../aws-cdk/lib/toolkit/cli-io-host';
