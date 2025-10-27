import * as os from 'os';
import * as fs_path from 'path';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import * as fs from 'fs-extra';
import { validate } from 'jsonschema';
import { Context, PROJECT_CONTEXT } from '../api/context';
import { Settings } from '../api/settings';
import type { Tag } from '../api/tags';
import type { IoHelper } from '../api-private';
import { cdkConfigSchema } from '../schema';

export const PROJECT_CONFIG = 'cdk.json';
export { PROJECT_CONTEXT } from '../api/context';
export const USER_DEFAULTS = '~/.cdk.json';
const CONTEXT_KEY = 'context';

export enum Command {
  LS = 'ls',
  LIST = 'list',
  DIFF = 'diff',
  BOOTSTRAP = 'bootstrap',
  DEPLOY = 'deploy',
  DESTROY = 'destroy',
  SYNTHESIZE = 'synthesize',
  SYNTH = 'synth',
  METADATA = 'metadata',
  INIT = 'init',
  VERSION = 'version',
  WATCH = 'watch',
  GC = 'gc',
  FLAGS = 'flags',
  ROLLBACK = 'rollback',
  IMPORT = 'import',
  ACKNOWLEDGE = 'acknowledge',
  ACK = 'ack',
  NOTICES = 'notices',
  MIGRATE = 'migrate',
  CONTEXT = 'context',
  DOCS = 'docs',
  DOC = 'doc',
  DOCTOR = 'doctor',
  REFACTOR = 'refactor',
  DRIFT = 'drift',
  CLI_TELEMETRY = 'cli-telemetry',
}

const BUNDLING_COMMANDS = [
  Command.DEPLOY,
  Command.DIFF,
  Command.SYNTH,
  Command.SYNTHESIZE,
  Command.WATCH,
  Command.IMPORT,
];

export type Arguments = {
  readonly _: [Command, ...string[]];
  readonly exclusively?: boolean;
  readonly STACKS?: string[];
  readonly lookups?: boolean;
  readonly [name: string]: unknown;
};

export interface ConfigurationProps {
  /**
   * Configuration passed via command line arguments
   *
   * @default - Nothing passed
   */
  readonly commandLineArguments?: Arguments;

  /**
   * Whether or not to use context from `.cdk.json` in user home directory
   *
   * @default true
   */
  readonly readUserContext?: boolean;
}

/**
 * All sources of settings combined
 */
export class Configuration {
  /**
   * Creates user configuration from commandLineArguments
   */
  public static async fromArgs(ioHelper: IoHelper, args?: Arguments) {
    const commandLineArguments = args
      ? await commandLineArgumentsToSettings(ioHelper, args)
      : new Settings();

    return new Configuration(ioHelper, commandLineArguments);
  }

  /**
   * Creates user configuration from commandLineArguments and loads
   */
  public static async fromArgsAndFiles(ioHelper: IoHelper, props: ConfigurationProps = {}) {
    const configuration = await Configuration.fromArgs(ioHelper, props.commandLineArguments);
    return configuration.loadConfigFiles(props.readUserContext ?? true);
  }

  public settings = new Settings();
  public context = new Context();

  public readonly defaultConfig = new Settings({
    versionReporting: true,
    assetMetadata: true,
    pathMetadata: true,
    output: 'cdk.out',
  });

  private readonly commandLineArguments: Settings;
  private readonly commandLineContext: Settings;
  private _projectConfig?: Settings;
  private _projectContext?: Settings;
  private loaded = false;

  private ioHelper: IoHelper;

  private constructor(ioHelper: IoHelper, commandLineArguments: Settings) {
    this.ioHelper = ioHelper;
    this.commandLineArguments = commandLineArguments;
    this.commandLineContext = this.commandLineArguments
      .subSettings([CONTEXT_KEY])
      .makeReadOnly();
  }

  private get projectConfig() {
    if (!this._projectConfig) {
      throw new ToolkitError('#load has not been called yet!');
    }
    return this._projectConfig;
  }

  public get projectContext() {
    if (!this._projectContext) {
      throw new ToolkitError('#load has not been called yet!');
    }
    return this._projectContext;
  }

  /**
   * Load all config
   */
  private async loadConfigFiles(readUserContext: boolean): Promise<this> {
    const userConfig = await loadAndLog(this.ioHelper, USER_DEFAULTS);
    this._projectConfig = await loadAndLog(this.ioHelper, PROJECT_CONFIG);
    this._projectContext = await loadAndLog(this.ioHelper, PROJECT_CONTEXT);

    if (userConfig.get(['build'])) {
      throw new ToolkitError(
        'The `build` key cannot be specified in the user config (~/.cdk.json), specify it in the project config (cdk.json) instead',
      );
    }

    const contextSources = [
      { bag: this.commandLineContext },
      {
        fileName: PROJECT_CONFIG,
        bag: this.projectConfig.subSettings([CONTEXT_KEY]).makeReadOnly(),
      },
      { fileName: PROJECT_CONTEXT, bag: this.projectContext },
    ];
    if (readUserContext) {
      contextSources.push({
        fileName: USER_DEFAULTS,
        bag: userConfig.subSettings([CONTEXT_KEY]).makeReadOnly(),
      });
    }

    this.context = new Context(...contextSources);

    // Build settings from what's left
    this.settings = this.defaultConfig
      .merge(userConfig)
      .merge(this.projectConfig)
      .merge(this.commandLineArguments)
      .makeReadOnly();

    await this.ioHelper.defaults.debug('merged settings:', this.settings.all);

    this.loaded = true;

    return this;
  }

  /**
   * Save the project context
   */
  public async saveContext(): Promise<this> {
    if (!this.loaded) {
      return this;
    } // Avoid overwriting files with nothing

    await this.projectContext.save(PROJECT_CONTEXT);

    return this;
  }
}

async function loadAndLog(ioHelper: IoHelper, fileName: string): Promise<Settings> {
  const ret = await settingsFromFile(ioHelper, fileName);
  if (!ret.empty) {
    await ioHelper.defaults.debug(fileName + ':', JSON.stringify(ret.all, undefined, 2));
  }
  return ret;
}

async function settingsFromFile(ioHelper: IoHelper, fileName: string): Promise<Settings> {
  let settings;
  const expanded = expandHomeDir(fileName);
  if (await fs.pathExists(expanded)) {
    const data = await fs.readJson(expanded);

    await validateConfigurationFile(data, fileName, ioHelper);

    settings = new Settings(data);
  } else {
    settings = new Settings();
  }

  // See https://github.com/aws/aws-cdk/issues/59
  prohibitContextKeys(settings, ['default-account', 'default-region'], fileName);
  await warnAboutContextKey(ioHelper, settings, 'aws:', fileName);

  return settings;
}

function prohibitContextKeys(settings: Settings, keys: string[], fileName: string) {
  const context = settings.get(['context']);
  if (!context || typeof context !== 'object') {
    return;
  }

  for (const key of keys) {
    if (key in context) {
      throw new ToolkitError(
        `The 'context.${key}' key was found in ${fs_path.resolve(
          fileName,
        )}, but it is no longer supported. Please remove it.`,
      );
    }
  }
}

async function warnAboutContextKey(ioHelper: IoHelper, settings: Settings, prefix: string, fileName: string) {
  const context = settings.get(['context']);
  if (!context || typeof context !== 'object') {
    return;
  }

  for (const contextKey of Object.keys(context)) {
    if (contextKey.startsWith(prefix)) {
      await ioHelper.defaults.warning(
        `A reserved context key ('context.${prefix}') key was found in ${fs_path.resolve(
          fileName,
        )}, it might cause surprising behavior and should be removed.`,
      );
    }
  }
}

function expandHomeDir(x: string) {
  if (x.startsWith('~')) {
    return fs_path.join(os.homedir(), x.slice(1));
  }
  return x;
}

/**
 * Parse CLI arguments into Settings
 *
 * CLI arguments in must be accessed in the CLI code via
 * `configuration.settings.get(['argName'])` instead of via `args.argName`.
 *
 * The advantage is that they can be configured via `cdk.json` and
 * `$HOME/.cdk.json`. Arguments not listed below and accessed via this object
 * can only be specified on the command line.
 *
 * @param argv - the received CLI arguments.
 * @returns a new Settings object.
 */
export async function commandLineArgumentsToSettings(ioHelper: IoHelper, argv: Arguments): Promise<Settings> {
  const context = await parseStringContextListToObject(ioHelper, argv);
  const tags = await parseStringTagsListToObject(ioHelper, expectStringList(argv.tags));

  // Determine bundling stacks
  let bundlingStacks: string[];
  if (BUNDLING_COMMANDS.includes(argv._[0])) {
    // If we deploy, diff, synth or watch a list of stacks exclusively we skip
    // bundling for all other stacks.
    bundlingStacks = argv.exclusively ? argv.STACKS ?? ['**'] : ['**'];
  } else {
    // Skip bundling for all stacks
    bundlingStacks = [];
  }

  return new Settings({
    app: argv.app,
    browser: argv.browser,
    build: argv.build,
    caBundlePath: argv.caBundlePath,
    context,
    debug: argv.debug,
    tags,
    language: argv.language,
    pathMetadata: argv.pathMetadata,
    assetMetadata: argv.assetMetadata,
    profile: argv.profile,
    plugin: argv.plugin,
    requireApproval: argv.requireApproval,
    toolkitStackName: argv.toolkitStackName,
    toolkitBucket: {
      bucketName: argv.bootstrapBucketName,
      kmsKeyId: argv.bootstrapKmsKeyId,
    },
    versionReporting: argv.versionReporting,
    staging: argv.staging,
    output: argv.output,
    outputsFile: argv.outputsFile,
    progress: argv.progress,
    proxy: argv.proxy,
    bundlingStacks,
    lookups: argv.lookups,
    rollback: argv.rollback,
    notices: argv.notices,
    assetParallelism: argv['asset-parallelism'],
    assetPrebuild: argv['asset-prebuild'],
    ignoreNoStacks: argv['ignore-no-stacks'],
    hotswap: {
      ecs: {
        minimumHealthyPercent: argv.hotswapEcsMinimumHealthyPercent,
        maximumHealthyPercent: argv.hotswapEcsMaximumHealthyPercent,
        stabilizationTimeoutSeconds: argv.hotswapEcsStabilizationTimeoutSeconds,
      },
    },
    unstable: argv.unstable,
  });
}

function expectStringList(x: unknown): string[] | undefined {
  if (x === undefined) {
    return undefined;
  }
  if (!Array.isArray(x)) {
    throw new ToolkitError(`Expected array, got '${x}'`);
  }
  const nonStrings = x.filter((e) => typeof e !== 'string');
  if (nonStrings.length > 0) {
    throw new ToolkitError(`Expected list of strings, found ${nonStrings}`);
  }
  return x;
}

async function parseStringContextListToObject(ioHelper: IoHelper, argv: Arguments): Promise<any> {
  const context: any = {};

  for (const assignment of (argv as any).context || []) {
    const parts = assignment.split(/=(.*)/, 2);
    if (parts.length === 2) {
      await ioHelper.defaults.debug('CLI argument context: %s=%s', parts[0], parts[1]);
      if (parts[0].match(/^aws:.+/)) {
        throw new ToolkitError(
          `User-provided context cannot use keys prefixed with 'aws:', but ${parts[0]} was provided.`,
        );
      }
      context[parts[0]] = parts[1];
    } else {
      await ioHelper.defaults.warn(
        'Context argument is not an assignment (key=value): %s',
        assignment,
      );
    }
  }
  return context;
}

/**
 * Parse tags out of arguments
 *
 * Return undefined if no tags were provided, return an empty array if only empty
 * strings were provided
 */
async function parseStringTagsListToObject(
  ioHelper: IoHelper,
  argTags: string[] | undefined,
): Promise<Tag[] | undefined> {
  if (argTags === undefined) {
    return undefined;
  }
  if (argTags.length === 0) {
    return undefined;
  }
  const nonEmptyTags = argTags.filter((t) => t !== '');
  if (nonEmptyTags.length === 0) {
    return [];
  }

  const tags: Tag[] = [];

  for (const assignment of nonEmptyTags) {
    const parts = assignment.split(/=(.*)/, 2);
    if (parts.length === 2) {
      await ioHelper.defaults.debug('CLI argument tags: %s=%s', parts[0], parts[1]);
      tags.push({
        Key: parts[0],
        Value: parts[1],
      });
    } else {
      await ioHelper.defaults.warn('Tags argument is not an assignment (key=value): %s', assignment);
    }
  }
  return tags.length > 0 ? tags : undefined;
}

/**
 * Find similar property names to suggest corrections for typos
 */
function getTypeCorrectionHint(expectedType: string, actualValue: any): string {
  if (expectedType === 'boolean' && (actualValue === 'true' || actualValue === 'false')) {
    return ` (use ${actualValue} without quotes)`;
  }
  if (expectedType === 'string' && typeof actualValue === 'number') {
    return ` (use "${actualValue}" with quotes)`;
  }
  return '';
}

/**
 * Validates configuration data against the CDK JSON Schema and emits warnings for issues
 *
 * @param data - The configuration object to validate
 * @param fileName - The file name for error reporting
 * @param ioHelper - IoHelper for logging warnings
 */
async function validateConfigurationFile(data: any, fileName: string, ioHelper: IoHelper): Promise<void> {
  try {
    const schema = cdkConfigSchema;
    const result = validate(data, schema);

    await handleSchemaErrors(result.errors, fileName, ioHelper);

    await handleUnknownProperties(data, schema, fileName, ioHelper);
  } catch (error) {
    await ioHelper.defaults.debug(`Schema validation failed for ${fileName}: ${error}`);
  }
}

/**
 * Handles schema validation errors and emits appropriate warnings
 */
async function handleSchemaErrors(errors: any[], fileName: string, ioHelper: IoHelper): Promise<void> {
  if (!errors || errors.length === 0) {
    return;
  }

  for (const error of errors) {
    const propertyPath = error.property?.replace('instance.', '') || 'root';
    const propertyName = propertyPath || 'property';

    if (error.name === 'type') {
      const errorSchema = error.schema as any;
      const expectedType = Array.isArray(errorSchema.type)
        ? errorSchema.type.join(' or ')
        : errorSchema.type || 'unknown';
      const actualType = typeof error.instance;
      const hint = getTypeCorrectionHint(expectedType, error.instance);

      await ioHelper.defaults.warn(
        `${fileName}: '${propertyName}' should be ${expectedType}, got ${actualType}${hint}`,
      );
    } else if (error.name === 'enum') {
      const allowedValues = (error.schema as any).enum?.join(', ') || 'unknown';
      await ioHelper.defaults.warn(
        `${fileName}: '${propertyName}' must be one of: ${allowedValues}`,
      );
    } else if (error.name !== 'additionalProperties') {
      // Generic fallback for other validation errors (skip additionalProperties as we handle those separately)
      await ioHelper.defaults.warn(
        `${fileName}: ${error.message}`,
      );
    }
  }
}

/**
 * Handles unknown properties
 */
async function handleUnknownProperties(
  data: any,
  schema: any,
  fileName: string,
  ioHelper: IoHelper,
): Promise<void> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return;
  }

  const knownProperties = Object.keys(schema.properties || {});
  const unknownProperties = Object.keys(data).filter(prop => !knownProperties.includes(prop));

  for (const prop of unknownProperties) {
    await ioHelper.defaults.warn(
      `${fileName}: Unknown property '${prop}' (not a standard CDK property)`,
    );
  }
}
