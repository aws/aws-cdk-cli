// This is a barrel export file, of all known symbols that are imported by users from the `aws-cdk` package.
// Importing these symbols was never officially supported, but here we are.
// In order to preserver backwards-compatibly for these users, we re-export and preserve them as explicit subpath exports.
// See https://github.com/aws/aws-cdk/pull/33021 for more information.

// API
export { CfnEvaluationException } from './api/cloudformation';
export { Deployments } from './api/deployments';
export { deployStack } from './api-private';
export { PluginHost } from './api/plugin';
export { Settings } from './api/settings';
export { Bootstrapper } from './api/bootstrap';

// Note: All type exports are in `legacy-exports.ts`
export * from './legacy-logging-source';
export * from './legacy-aws-auth';

// CLI
export { CloudExecutable, execProgram } from './cxapp';
export { cli, exec } from './cli/cli';
export { cliRootDir as rootDir } from './cli/root-dir';
export { Command, Configuration, PROJECT_CONTEXT } from './cli/user-configuration';
export { formatAsBanner } from './cli/util/console-formatters';
export { versionNumber } from './cli/version';

// Commands
export { RequireApproval } from './commands/diff';
export { availableInitTemplates } from './commands/init';
export { aliases, command, describe } from './commands/docs';

// util
export { deepClone, flatten, ifDefined, isArray, isEmpty, numberFromBool, partition, padLeft as leftPad, contentHash, deepMerge, lowerCaseFirstCharacter } from './util';
