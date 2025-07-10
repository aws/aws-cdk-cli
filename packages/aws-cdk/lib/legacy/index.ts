// This is a barrel export file, of all known symbols that are imported by users from the `aws-cdk` package.
// Importing these symbols was never officially supported, but here we are.
// In order to preserver backwards-compatibly for these users, we re-export and preserve them as explicit subpath exports.
// See https://github.com/aws/aws-cdk/pull/33021 for more information.

// Legacy Type Copies
export type * from './types';

// Legacy Code Copies
export * from './logging';
export * from './aws-auth';
export { Command, Configuration, PROJECT_CONTEXT } from './configuration';

// API
export { CfnEvaluationException } from '../api/cloudformation';
export { Deployments } from '../api/deployments';
export { deployStack } from '../api-private';
export { PluginHost } from '../api/plugin';
export { Settings } from '../api/settings';
export { Bootstrapper } from '../api/bootstrap';

// CLI
export { CloudExecutable, execProgram } from '../cxapp';
export { cli, exec } from '../cli/cli';
export { cliRootDir as rootDir } from '../cli/root-dir';
export { formatAsBanner } from '../cli/util/console-formatters';
export { versionNumber } from '../cli/version-util';

// Commands
export { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
export { availableInitTemplates } from '../commands/init';
export { aliases, command, describe } from '../commands/docs';

// util
export { deepClone, flatten, ifDefined, isArray, isEmpty, numberFromBool, partition, padLeft as leftPad, contentHash, deepMerge, lowerCaseFirstCharacter } from '../util';
