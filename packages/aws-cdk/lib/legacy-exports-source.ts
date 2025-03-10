// This is a barrel export file, of all known symbols that are imported by users from the `aws-cdk` package.
// Importing these symbols was never officially supported, but here we are.
// In order to preserver backwards-compatibly for these users, we re-export and preserve them as explicit subpath exports.
// See https://github.com/aws/aws-cdk/pull/33021 for more information.

// Note: All type exports are in `legacy-exports.ts`
export { SdkProvider } from './api/aws-auth';
export { AwsCliCompatible } from './api/aws-auth/awscli-compatible';
export { cached } from './api/aws-auth/cached';
export { CredentialPlugins } from './api/aws-auth/credential-plugins';
export { setSdkTracing as enableTracing } from './api/aws-auth/tracing';
export { Bootstrapper } from './api/bootstrap';
export { CloudExecutable } from './api/cxapp/cloud-executable';
export { execProgram } from './api/cxapp/exec';
export { Deployments } from './api/deployments';
export { deployStack } from './api/deployments/deploy-stack';
export { CfnEvaluationException } from './api/evaluate-cloudformation-template';
export { lowerCaseFirstCharacter } from './api/hotswap/common';
export { PluginHost } from './api/plugin';
export { Settings } from './api/settings';
export { cli, exec } from './cli/cli';
export { Command, Configuration, PROJECT_CONTEXT } from './cli/user-configuration';
export { formatAsBanner } from './cli/util/console-formatters';
export { getVersionMessages as latestVersionIfHigher, versionNumber } from './cli/version';
export { aliases, command, describe } from './commands/docs';
export { RequireApproval } from './diff';
export { availableInitTemplates } from './init';
export * from './legacy-logging-source';
export { deepClone, flatten, ifDefined, isArray, isEmpty, numberFromBool, partition } from './util';
export { contentHash } from './util/content-hash';
export { cliRootDir as rootDir } from './cli/root-dir';
export { deepMerge } from './util/objects';
export { leftPad } from './util/string-manipulation';