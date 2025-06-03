// -------------------------------------------------------------------------------------------
// GENERATED FROM packages/aws-cdk/lib/cli/cli-config.ts.
// Do not edit by hand; all changes will be overwritten at build time from the config file.
// -------------------------------------------------------------------------------------------
/* eslint-disable @stylistic/max-len, @typescript-eslint/consistent-type-imports, @stylistic/quote-props */
import { Settings } from '../api/settings';
import * as helpers from './util/yargs-helpers';

const defaultConfig = {
  lookups: true,
  ignoreErrors: false,
  json: false,
  debug: false,
  versionReporting: true,
  pathMetadata: true,
  assetMetadata: true,
  staging: true,
  output: 'cdk.out',
  notices: helpers.shouldDisplayNotices(),
  noColor: false,
  ci: helpers.isCI(),
  unstable: [],
  list: {
    long: false,
    showDependencies: false,
  },
  synth: {
    validation: true,
    quiet: false,
  },
  bootstrap: {
    tags: [],
    execute: true,
    trust: [],
    trustForLookup: [],
    untrust: [],
    cloudformationExecutionPolicies: [],
    force: false,
    showTemplate: false,
    previousParameters: true,
  },
  gc: {
    action: 'full',
    type: 'all',
    rollbackBufferDays: 0,
    createdBufferDays: 1,
    confirm: true,
  },
  deploy: {
    all: false,
    buildExclude: [],
    importExistingResources: false,
    force: false,
    parameters: {},
    previousParameters: true,
    logs: true,
    concurrency: 1,
    assetPrebuild: true,
    ignoreNoStacks: false,
  },
  rollback: {
    all: false,
    orphan: [],
  },
  import: {
    execute: true,
  },
  watch: {
    buildExclude: [],
    force: false,
    logs: true,
    concurrency: 1,
  },
  destroy: {
    all: false,
  },
  diff: {
    contextLines: 3,
    strict: false,
    securityOnly: false,
    processed: false,
    quiet: false,
    changeSet: true,
    importExistingResources: false,
  },
  init: {
    generateOnly: false,
  },
  migrate: {
    language: 'typescript',
  },
  context: {
    force: false,
    clear: false,
  },
  docs: {
    browser: helpers.browserForPlatform(),
  },
  refactor: {
    dryRun: false,
    revert: false,
  },
};
export const CLI_DEFAULTS = new Settings(defaultConfig);
