import * as cxapi from '@aws-cdk/cx-api';
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
import * as version from './version';
import { ToolkitError } from '../../../@aws-cdk/toolkit-lib';
import { asIoHelper, IO } from '../../../@aws-cdk/toolkit-lib/lib/api/io/private';
import { makeRequestHandler } from '../../../@aws-cdk/toolkit-lib/lib/api/shared-private';
import { SdkProvider, SdkToCliLogger, setSdkTracing } from '../api/aws-auth';
import type { BootstrapSource } from '../api/bootstrap';
import { Bootstrapper } from '../api/bootstrap';
import type { DeploymentMethod } from '../api/deployments';
import { Deployments } from '../api/deployments';
import { HotswapMode } from '../api/hotswap';
import { Notices } from '../api/notices';
import type { IReadLock } from '../api/rwlock';
import type { Settings } from '../api/settings';
import { ToolkitInfo } from '../api/toolkit-info';
import { contextHandler as context } from '../commands/context';
import { docs } from '../commands/docs';
import { doctor } from '../commands/doctor';
import { cliInit, printAvailableTemplates } from '../commands/init';
import { getMigrateScanType } from '../commands/migrate';
import { execProgram, CloudExecutable } from '../cxapp';
import type { StackSelector, Synthesizer } from '../cxapp';
import { durationToSeconds } from './util/duration';
/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/no-shadow */ // yargs

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

  const ioHost = CliIoHost.instance({
    logLevel: ioMessageLevel,
    isTTY: process.stdout.isTTY,
    isCI: Boolean(argv.ci),
    currentAction: cmd,
    stackProgress: argv.progress,
  }, true);

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
    ioHost.defaults.debug(`Error while checking for platform warnings: ${e}`);
  }

  ioHost.defaults.debug('CDK Toolkit CLI version:', version.displayVersion());
  ioHost.defaults.debug('Command line arguments:', argv);

  const configuration = new Configuration({
    commandLineArguments: {
      ...argv,
      _: argv._ as [Command, ...string[]], // TypeScript at its best
    },
  });
  await configuration.load();

  const ioHelper = asIoHelper(ioHost, ioHost.currentAction as any);

  const shouldDisplayNotices = configuration.settings.get(['notices']);
  // Notices either go to stderr, or nowhere
  ioHost.noticesDestination = shouldDisplayNotices ? 'stderr' : 'drop';
  const notices = Notices.create({
    ioHost,
    context: configuration.context,
    output: configuration.settings.get(['outdir']),
    httpOptions: {
      proxyAddress: configuration.settings.get(['proxy']),
      caBundlePath: configuration.settings.get(['caBundlePath']),
    },
    cliVersion: version.versionNumber(),
  });
  const refreshNotices = (async () => {
    // the cdk notices command has it's own refresh
    if (shouldDisplayNotices && cmd !== 'notices') {
      try {
        return await notices.refresh();
      } catch (e: any) {
        await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(`Could not refresh notices: ${e}`));
      }
    }
  })();

  const sdkProvider = await SdkProvider.withAwsCliCompatibleDefaults({
    ioHelper,
    profile: configuration.settings.get(['profile']),
    requestHandler: await makeRequestHandler(ioHelper, {
      proxyAddress: argv.proxy,
      caBundlePath: argv['ca-bundle-path'],
    }),
    logger: new SdkToCliLogger(asIoHelper(ioHost, ioHost.currentAction as any)),
    pluginHost: GLOBAL_PLUGIN_HOST,
  });

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
  function loadPlugins(...settings: Settings[]) {
    for (const source of settings) {
      const plugins: string[] = source.get(['plugin']) || [];
      for (const plugin of plugins) {
        GLOBAL_PLUGIN_HOST.load(plugin, ioHost);
      }
    }
  }

  loadPlugins(configuration.settings);

  if ((typeof cmd) !== 'string') {
    throw new ToolkitError(`First argument should be a string. Got: ${cmd} (${typeof cmd})`);
  }

  try {
    return await main(cmd, argv);
  } finally {
    // If we locked the 'cdk.out' directory, release it here.
    await outDirLock?.release();

    // Do PSAs here
    await version.displayVersionMessage();

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
    ioHost.defaults.debug(`Toolkit stack: ${chalk.bold(toolkitStackName)}`);

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
        });

      case 'bootstrap':
        ioHost.currentAction = 'bootstrap';
        const source: BootstrapSource = determineBootstrapVersion(ioHost, args);

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

        let deploymentMethod: DeploymentMethod | undefined;
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
            deploymentMethod = {
              method: 'change-set',
              execute: args.execute ?? true,
              changeSetName: args.changeSetName,
              importExistingResources: args.importExistingResources,
            };
            break;
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
          deploymentMethod,
          force: args.force,
          parameters: parameterMap,
          usePreviousParameters: args['previous-parameters'],
          outputsFile: configuration.settings.get(['outputsFile']),
          progress: configuration.settings.get(['progress']),
          ci: args.ci,
          rollback: configuration.settings.get(['rollback']),
          hotswap: determineHotswapMode(args.hotswap, args.hotswapFallback),
          hotswapOperationOptions: { timeoutSeconds: args.hotswapTimeout ? durationToSeconds(args.hotswapTimeout): undefined },
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
          deploymentMethod: {
            method: 'change-set',
            changeSetName: args.changeSetName,
          },
          force: args.force,
          progress: configuration.settings.get(['progress']),
          rollback: configuration.settings.get(['rollback']),
          hotswap: determineHotswapMode(args.hotswap, args.hotswapFallback, true),
          hotswapOperationOptions: { timeoutSeconds: args.hotswapTimeout ? durationToSeconds(args.hotswapTimeout): undefined },
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
        return ioHost.defaults.result(version.displayVersion());

      default:
        throw new ToolkitError('Unknown command: ' + command);
    }
  }
}

/**
 * Determine which version of bootstrapping
 */
function determineBootstrapVersion(ioHost: CliIoHost, args: { template?: string }): BootstrapSource {
  let source: BootstrapSource;
  if (args.template) {
    ioHost.defaults.info(`Using bootstrapping template from ${args.template}`);
    source = { source: 'custom', templateFile: args.template };
  } else if (process.env.CDK_LEGACY_BOOTSTRAP) {
    ioHost.defaults.info('CDK_LEGACY_BOOTSTRAP set, using legacy-style bootstrapping');
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
  exec(args)
    .then(async (value) => {
      if (typeof value === 'number') {
        process.exitCode = value;
      }
    })
    .catch((err) => {
      // Log the stack trace if we're on a developer workstation. Otherwise this will be into a minified
      // file and the printed code line and stack trace are huge and useless.
      prettyPrintError(err, version.isDeveloperBuild());
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
