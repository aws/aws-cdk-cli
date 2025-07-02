/* eslint-disable @typescript-eslint/no-shadow */ // yargs
import * as cxapi from '@aws-cdk/cx-api';
import type { ChangeSetDeployment, DeploymentMethod, DirectDeployment } from '@aws-cdk/toolkit-lib';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import { CdkToolkit, AssetBuildTime } from './cdk-toolkit';
import type { IoMessageLevel } from './io-host';
import { CliIoHost } from './io-host';
import { parseCommandLineArguments } from './parse-command-line-arguments';
import { checkForPlatformWarnings } from './platform-warnings';
import { prettyPrintError } from './pretty-print-error';
import { GLOBAL_PLUGIN_HOST } from './singleton-plugin-host';
import type { Command } from './user-configuration';
import { Configuration } from './user-configuration';
import { displayVersion, isDeveloperBuild, versionNumber } from './version-util';
import { asIoHelper } from '../../lib/api-private';
import type { IReadLock } from '../api';
import { ToolkitInfo, Notices } from '../api';
import { SdkProvider, IoHostSdkLogger, setSdkTracing, sdkRequestHandler } from '../api/aws-auth';
import type { BootstrapSource } from '../api/bootstrap';
import { Bootstrapper } from '../api/bootstrap';
import { Deployments } from '../api/deployments';
import { HotswapMode } from '../api/hotswap';
import type { Settings } from '../api/settings';
import { contextHandler as context } from '../commands/context';
import { docs } from '../commands/docs';
import { doctor } from '../commands/doctor';
import { cliInit, printAvailableTemplates } from '../commands/init';
import { getMigrateScanType } from '../commands/migrate';
import { execProgram, CloudExecutable } from '../cxapp';
import type { StackSelector, Synthesizer } from '../cxapp';
import { ProxyAgentProvider } from './proxy-agent';
import type { ErrorDetails } from './telemetry/schema';
import { displayVersionMessage } from './version';

if (!process.stdout.isTTY) {
  // Disable chalk color highlighting
  process.env.FORCE_COLOR = '0';
}

export async function exec(args: string[], synthesizer?: Synthesizer): Promise<number | void> {
  const argv = await parseCommandLineArguments(args);
  const cmd = argv._[0];

  // if one -v, log at a DEBUG level
  // if 2 -v, log at a TRACE level
  let ioMessageLevel: IoMessageLevel = 'info';
  if (argv.verbose) {
    switch (argv.verbose) {
      case 1:
        ioMessageLevel = 'debug';
        break;
      case 2:
      default:
        ioMessageLevel = 'trace';
        break;
    }
  }

  const configuration = new Configuration({
    commandLineArguments: {
      ...argv,
      _: argv._ as [Command, ...string[]], // TypeScript at its best
    },
  });
  await configuration.load();

  const ioHost = CliIoHost.instance({
    logLevel: ioMessageLevel,
    isTTY: process.stdout.isTTY,
    isCI: Boolean(argv.ci),
    currentAction: cmd,
    stackProgress: argv.progress,
    arguments: argv,
    context: configuration.context,
  }, true);
  await ioHost.begin();

  // Debug should always imply tracing
  if (argv.debug || argv.verbose > 2) {
    setSdkTracing(true);
  } else {
    // cli-lib-alpha needs to explicitly set in case it was enabled before
    setSdkTracing(false);
  }

  try {
    await checkForPlatformWarnings();
  } catch (e) {
    await ioHost.defaults.debug(`Error while checking for platform warnings: ${e}`);
  }

  await ioHost.defaults.debug('CDK Toolkit CLI version:', displayVersion());
  await ioHost.defaults.debug('Command line arguments:', argv);

  const ioHelper = asIoHelper(ioHost, ioHost.currentAction as any);

  // Always create and use ProxyAgent to support configuration via env vars
  const proxyAgent = await new ProxyAgentProvider(ioHelper).create({
    proxyAddress: configuration.settings.get(['proxy']),
    caBundlePath: configuration.settings.get(['caBundlePath']),
  });

  const shouldDisplayNotices = configuration.settings.get(['notices']);
  // Notices either go to stderr, or nowhere
  ioHost.noticesDestination = shouldDisplayNotices ? 'stderr' : 'drop';
  const notices = Notices.create({
    ioHost,
    context: configuration.context,
    output: configuration.settings.get(['outdir']),
    httpOptions: { agent: proxyAgent },
    cliVersion: versionNumber(),
  });
  const refreshNotices = (async () => {
    // the cdk notices command has it's own refresh
    if (shouldDisplayNotices && cmd !== 'notices') {
      try {
        return await notices.refresh();
      } catch (e: any) {
        await ioHelper.defaults.debug(`Could not refresh notices: ${e}`);
      }
    }
  })();

  const sdkProvider = await SdkProvider.withAwsCliCompatibleDefaults({
    ioHelper,
    requestHandler: sdkRequestHandler(proxyAgent),
    logger: new IoHostSdkLogger(asIoHelper(ioHost, ioHost.currentAction as any)),
    pluginHost: GLOBAL_PLUGIN_HOST,
  }, configuration.settings.get(['profile']));

  let outDirLock: IReadLock | undefined;
  const cloudExecutable = new CloudExecutable({
    configuration,
    sdkProvider,
    synthesizer:
      synthesizer ??
      (async (aws, config) => {
        // Invoke 'execProgram', and copy the lock for the directory in the global
        // variable here. It will be released when the CLI exits. Locks are not re-entrant
        // so release it if we have to synthesize more than once (because of context lookups).
        await outDirLock?.release();
        const { assembly, lock } = await execProgram(aws, ioHost.asIoHelper(), config);
        outDirLock = lock;
        return assembly;
      }),
    ioHelper: ioHost.asIoHelper(),
  });

  /** Function to load plug-ins, using configurations additively. */
  async function loadPlugins(...settings: Settings[]) {
    for (const source of settings) {
      const plugins: string[] = source.get(['plugin']) || [];
      for (const plugin of plugins) {
        await GLOBAL_PLUGIN_HOST.load(plugin, ioHost);
      }
    }
  }

  await loadPlugins(configuration.settings);

  if ((typeof cmd) !== 'string') {
    throw new ToolkitError(`First argument should be a string. Got: ${cmd} (${typeof cmd})`);
  }

  try {
    return await main(cmd, argv);
  } finally {
    // If we locked the 'cdk.out' directory, release it here.
    await outDirLock?.release();

    // Do PSAs here
    await displayVersionMessage();

    await refreshNotices;
    if (cmd === 'notices') {
      await notices.refresh({ force: true });
      await notices.display({
        includeAcknowledged: !argv.unacknowledged,
        showTotal: argv.unacknowledged,
      });
    } else if (cmd !== 'version') {
      await notices.display();
    }
  }

  async function main(command: string, args: any): Promise<number | void> {
    ioHost.currentAction = command as any;
    const toolkitStackName: string = ToolkitInfo.determineName(configuration.settings.get(['toolkitStackName']));
    await ioHost.defaults.debug(`Toolkit stack: ${chalk.bold(toolkitStackName)}`);

    const cloudFormation = new Deployments({
      sdkProvider,
      toolkitStackName,
      ioHelper: asIoHelper(ioHost, ioHost.currentAction as any),
    });

    if (args.all && args.STACKS) {
      throw new ToolkitError('You must either specify a list of Stacks or the `--all` argument');
    }

    args.STACKS = args.STACKS ?? (args.STACK ? [args.STACK] : []);
    args.ENVIRONMENTS = args.ENVIRONMENTS ?? [];

    const selector: StackSelector = {
      allTopLevel: args.all,
      patterns: args.STACKS,
    };

    const cli = new CdkToolkit({
      ioHost,
      cloudExecutable,
      toolkitStackName,
      deployments: cloudFormation,
      verbose: argv.trace || argv.verbose > 0,
      ignoreErrors: argv['ignore-errors'],
      strict: argv.strict,
      configuration,
      sdkProvider,
    });

    switch (command) {
      case 'context':
        ioHost.currentAction = 'context';
        return context({
          context: configuration.context,
          clear: argv.clear,
          json: argv.json,
          force: argv.force,
          reset: argv.reset,
        });

      case 'docs':
      case 'doc':
        ioHost.currentAction = 'docs';
        return docs({ browser: configuration.settings.get(['browser']) });

      case 'doctor':
        ioHost.currentAction = 'doctor';
        return doctor();

      case 'ls':
      case 'list':
        ioHost.currentAction = 'list';
        return cli.list(args.STACKS, {
          long: args.long,
          json: argv.json,
          showDeps: args.showDependencies,
        });

      case 'diff':
        ioHost.currentAction = 'diff';
        const enableDiffNoFail = isFeatureEnabled(configuration, cxapi.ENABLE_DIFF_NO_FAIL_CONTEXT);
        return cli.diff({
          stackNames: args.STACKS,
          exclusively: args.exclusively,
          templatePath: args.template,
          strict: args.strict,
          contextLines: args.contextLines,
          securityOnly: args.securityOnly,
          fail: args.fail != null ? args.fail : !enableDiffNoFail,
          compareAgainstProcessedTemplate: args.processed,
          quiet: args.quiet,
          changeSet: args['change-set'],
          toolkitStackName: toolkitStackName,
          importExistingResources: args.importExistingResources,
        });

      case 'drift':
        ioHost.currentAction = 'drift';
        return cli.drift({
          selector,
          fail: args.fail,
        });

      case 'refactor':
        if (!configuration.settings.get(['unstable']).includes('refactor')) {
          throw new ToolkitError('Unstable feature use: \'refactor\' is unstable. It must be opted in via \'--unstable\', e.g. \'cdk refactor --unstable=refactor\'');
        }

        ioHost.currentAction = 'refactor';
        return cli.refactor({
          dryRun: args.dryRun,
          selector,
          excludeFile: args.excludeFile,
          mappingFile: args.mappingFile,
          revert: args.revert,
        });

      case 'bootstrap':
        ioHost.currentAction = 'bootstrap';
        const source: BootstrapSource = await determineBootstrapVersion(ioHost, args);

        if (args.showTemplate) {
          const bootstrapper = new Bootstrapper(source, asIoHelper(ioHost, ioHost.currentAction));
          return bootstrapper.showTemplate(args.json);
        }

        return cli.bootstrap(args.ENVIRONMENTS, {
          source,
          roleArn: args.roleArn,
          forceDeployment: argv.force,
          toolkitStackName: toolkitStackName,
          execute: args.execute,
          tags: configuration.settings.get(['tags']),
          terminationProtection: args.terminationProtection,
          usePreviousParameters: args['previous-parameters'],
          parameters: {
            bucketName: configuration.settings.get(['toolkitBucket', 'bucketName']),
            kmsKeyId: configuration.settings.get(['toolkitBucket', 'kmsKeyId']),
            createCustomerMasterKey: args.bootstrapCustomerKey,
            qualifier: args.qualifier ?? configuration.context.get('@aws-cdk/core:bootstrapQualifier'),
            publicAccessBlockConfiguration: args.publicAccessBlockConfiguration,
            examplePermissionsBoundary: argv.examplePermissionsBoundary,
            customPermissionsBoundary: argv.customPermissionsBoundary,
            trustedAccounts: arrayFromYargs(args.trust),
            trustedAccountsForLookup: arrayFromYargs(args.trustForLookup),
            untrustedAccounts: arrayFromYargs(args.untrust),
            cloudFormationExecutionPolicies: arrayFromYargs(args.cloudformationExecutionPolicies),
          },
        });

      case 'deploy':
        ioHost.currentAction = 'deploy';
        const parameterMap: { [name: string]: string | undefined } = {};
        for (const parameter of args.parameters) {
          if (typeof parameter === 'string') {
            const keyValue = (parameter as string).split('=');
            parameterMap[keyValue[0]] = keyValue.slice(1).join('=');
          }
        }

        if (args.execute !== undefined && args.method !== undefined) {
          throw new ToolkitError('Can not supply both --[no-]execute and --method at the same time');
        }

        return cli.deploy({
          selector,
          exclusively: args.exclusively,
          toolkitStackName,
          roleArn: args.roleArn,
          notificationArns: args.notificationArns,
          requireApproval: configuration.settings.get(['requireApproval']),
          reuseAssets: args['build-exclude'],
          tags: configuration.settings.get(['tags']),
          deploymentMethod: determineDeploymentMethod(args, configuration),
          force: args.force,
          parameters: parameterMap,
          usePreviousParameters: args['previous-parameters'],
          outputsFile: configuration.settings.get(['outputsFile']),
          progress: configuration.settings.get(['progress']),
          ci: args.ci,
          rollback: configuration.settings.get(['rollback']),
          watch: args.watch,
          traceLogs: args.logs,
          concurrency: args.concurrency,
          assetParallelism: configuration.settings.get(['assetParallelism']),
          assetBuildTime: configuration.settings.get(['assetPrebuild'])
            ? AssetBuildTime.ALL_BEFORE_DEPLOY
            : AssetBuildTime.JUST_IN_TIME,
          ignoreNoStacks: args.ignoreNoStacks,
        });

      case 'rollback':
        ioHost.currentAction = 'rollback';
        return cli.rollback({
          selector,
          toolkitStackName,
          roleArn: args.roleArn,
          force: args.force,
          validateBootstrapStackVersion: args['validate-bootstrap-version'],
          orphanLogicalIds: args.orphan,
        });

      case 'import':
        ioHost.currentAction = 'import';
        return cli.import({
          selector,
          toolkitStackName,
          roleArn: args.roleArn,
          deploymentMethod: {
            method: 'change-set',
            execute: args.execute,
            changeSetName: args.changeSetName,
          },
          progress: configuration.settings.get(['progress']),
          rollback: configuration.settings.get(['rollback']),
          recordResourceMapping: args['record-resource-mapping'],
          resourceMappingFile: args['resource-mapping'],
          force: args.force,
        });

      case 'watch':
        ioHost.currentAction = 'watch';
        await cli.watch({
          selector,
          exclusively: args.exclusively,
          toolkitStackName,
          roleArn: args.roleArn,
          reuseAssets: args['build-exclude'],
          deploymentMethod: determineDeploymentMethod(args, configuration, true),
          force: args.force,
          progress: configuration.settings.get(['progress']),
          rollback: configuration.settings.get(['rollback']),
          traceLogs: args.logs,
          concurrency: args.concurrency,
        });
        return;

      case 'destroy':
        ioHost.currentAction = 'destroy';
        return cli.destroy({
          selector,
          exclusively: args.exclusively,
          force: args.force,
          roleArn: args.roleArn,
        });

      case 'gc':
        ioHost.currentAction = 'gc';
        if (!configuration.settings.get(['unstable']).includes('gc')) {
          throw new ToolkitError('Unstable feature use: \'gc\' is unstable. It must be opted in via \'--unstable\', e.g. \'cdk gc --unstable=gc\'');
        }
        return cli.garbageCollect(args.ENVIRONMENTS, {
          action: args.action,
          type: args.type,
          rollbackBufferDays: args['rollback-buffer-days'],
          createdBufferDays: args['created-buffer-days'],
          bootstrapStackName: args.bootstrapStackName,
          confirm: args.confirm,
        });

      case 'synthesize':
      case 'synth':
        ioHost.currentAction = 'synth';
        const quiet = configuration.settings.get(['quiet']) ?? args.quiet;
        if (args.exclusively) {
          return cli.synth(args.STACKS, args.exclusively, quiet, args.validation, argv.json);
        } else {
          return cli.synth(args.STACKS, true, quiet, args.validation, argv.json);
        }

      case 'notices':
        ioHost.currentAction = 'notices';
        // If the user explicitly asks for notices, they are now the primary output
        // of the command and they should go to stdout.
        ioHost.noticesDestination = 'stdout';

        // This is a valid command, but we're postponing its execution because displaying
        // notices automatically happens after every command.
        return;

      case 'metadata':
        ioHost.currentAction = 'metadata';
        return cli.metadata(args.STACK, argv.json);

      case 'acknowledge':
      case 'ack':
        ioHost.currentAction = 'notices';
        return cli.acknowledge(args.ID);

      case 'cli-telemetry':
        ioHost.currentAction = 'cli-telemetry';
        if (args.enable === undefined && args.disable === undefined) {
          throw new ToolkitError('Must specify either \'--enable\' or \'--disable\'');
        }

        const enable = args.enable ?? !args.disable;
        return cli.cliTelemetry(enable);

      case 'init':
        ioHost.currentAction = 'init';
        const language = configuration.settings.get(['language']);
        if (args.list) {
          return printAvailableTemplates(language);
        } else {
          return cliInit({
            type: args.TEMPLATE,
            language,
            canUseNetwork: undefined,
            generateOnly: args.generateOnly,
            libVersion: args.libVersion,
          });
        }
      case 'migrate':
        ioHost.currentAction = 'migrate';
        return cli.migrate({
          stackName: args['stack-name'],
          fromPath: args['from-path'],
          fromStack: args['from-stack'],
          language: args.language,
          outputPath: args['output-path'],
          fromScan: getMigrateScanType(args['from-scan']),
          filter: args.filter,
          account: args.account,
          region: args.region,
          compress: args.compress,
        });
      case 'version':
        ioHost.currentAction = 'version';
        return ioHost.defaults.result(displayVersion());

      default:
        throw new ToolkitError('Unknown command: ' + command);
    }
  }
}

/**
 * Determine which version of bootstrapping
 */
async function determineBootstrapVersion(ioHost: CliIoHost, args: { template?: string }): Promise<BootstrapSource> {
  let source: BootstrapSource;
  if (args.template) {
    await ioHost.defaults.info(`Using bootstrapping template from ${args.template}`);
    source = { source: 'custom', templateFile: args.template };
  } else if (process.env.CDK_LEGACY_BOOTSTRAP) {
    await ioHost.defaults.info('CDK_LEGACY_BOOTSTRAP set, using legacy-style bootstrapping');
    source = { source: 'legacy' };
  } else {
    // in V2, the "new" bootstrapping is the default
    source = { source: 'default' };
  }
  return source;
}

function isFeatureEnabled(configuration: Configuration, featureFlag: string) {
  return configuration.context.get(featureFlag) ?? cxapi.futureFlagDefault(featureFlag);
}

/**
 * Translate a Yargs input array to something that makes more sense in a programming language
 * model (telling the difference between absence and an empty array)
 *
 * - An empty array is the default case, meaning the user didn't pass any arguments. We return
 *   undefined.
 * - If the user passed a single empty string, they did something like `--array=`, which we'll
 *   take to mean they passed an empty array.
 */
function arrayFromYargs(xs: string[]): string[] | undefined {
  if (xs.length === 0) {
    return undefined;
  }
  return xs.filter((x) => x !== '');
}

function determineDeploymentMethod(args: any, configuration: Configuration, watch?: boolean): DeploymentMethod {
  let deploymentMethod: ChangeSetDeployment | DirectDeployment | undefined;
  switch (args.method) {
    case 'direct':
      if (args.changeSetName) {
        throw new ToolkitError('--change-set-name cannot be used with method=direct');
      }
      if (args.importExistingResources) {
        throw new ToolkitError('--import-existing-resources cannot be enabled with method=direct');
      }
      deploymentMethod = { method: 'direct' };
      break;
    case 'change-set':
      deploymentMethod = {
        method: 'change-set',
        execute: true,
        changeSetName: args.changeSetName,
        importExistingResources: args.importExistingResources,
      };
      break;
    case 'prepare-change-set':
      deploymentMethod = {
        method: 'change-set',
        execute: false,
        changeSetName: args.changeSetName,
        importExistingResources: args.importExistingResources,
      };
      break;
    case undefined:
    default:
      deploymentMethod = {
        method: 'change-set',
        execute: watch ? true : args.execute ?? true,
        changeSetName: args.changeSetName,
        importExistingResources: args.importExistingResources,
      };
      break;
  }

  const hotswapMode = determineHotswapMode(args.hotswap, args.hotswapFallback, watch);
  const hotswapProperties = configuration.settings.get(['hotswap']) || {};
  switch (hotswapMode) {
    case HotswapMode.FALL_BACK:
      return {
        method: 'hotswap',
        properties: hotswapProperties,
        fallback: deploymentMethod,
      };
    case HotswapMode.HOTSWAP_ONLY:
      return {
        method: 'hotswap',
        properties: hotswapProperties,
      };
    default:
    case HotswapMode.FULL_DEPLOYMENT:
      return deploymentMethod;
  }
}

function determineHotswapMode(hotswap?: boolean, hotswapFallback?: boolean, watch?: boolean): HotswapMode {
  if (hotswap && hotswapFallback) {
    throw new ToolkitError('Can not supply both --hotswap and --hotswap-fallback at the same time');
  } else if (!hotswap && !hotswapFallback) {
    if (hotswap === undefined && hotswapFallback === undefined) {
      return watch ? HotswapMode.HOTSWAP_ONLY : HotswapMode.FULL_DEPLOYMENT;
    } else if (hotswap === false || hotswapFallback === false) {
      return HotswapMode.FULL_DEPLOYMENT;
    }
  }

  let hotswapMode: HotswapMode;
  if (hotswap) {
    hotswapMode = HotswapMode.HOTSWAP_ONLY;
    /* if (hotswapFallback)*/
  } else {
    hotswapMode = HotswapMode.FALL_BACK;
  }

  return hotswapMode;
}

/* c8 ignore start */ // we never call this in unit tests
export function cli(args: string[] = process.argv.slice(2)) {
  let error: ErrorDetails | undefined;
  exec(args)
    .then(async (value) => {
      if (typeof value === 'number') {
        process.exitCode = value;
      }
    })
    .catch(async (err) => {
      // Log the stack trace if we're on a developer workstation. Otherwise this will be into a minified
      // file and the printed code line and stack trace are huge and useless.
      prettyPrintError(err, isDeveloperBuild());
      error = err;
      process.exitCode = 1;
    })
    .finally(() => {
      if (!error && process.exitCode === 1) {
        // The existence of an error determines if telemetry is successful or not so we create a
        // dummy error in the event that exit code is 1 but no error is thrown
        error = { name: 'ExitCode1Error' };
      }
      CliIoHost.get()?.end(error);
    });
}
/* c8 ignore stop */
