import type { DefaultCdkOptions, DestroyOptions } from '@aws-cdk/cloud-assembly-schema/lib/integ-tests';
import type { SynthOptions, ListOptions, DeployOptions } from './commands';
import { StackActivityProgress, HotswapMode } from './commands';
import { exec, watch } from './utils';

export type WatchEvents = {
  onStdout?: (chunk: any) => void;
  onStderr?: (chunk: any) => void;
  onClose?: (code: number | null) => void;
};

/**
 * AWS CDK CLI operations
 */
export interface ICdk {

  /**
   * cdk deploy
   */
  deploy(options: DeployOptions): Promise<void>;

  /**
   * cdk synth
   */
  synth(options: SynthOptions): Promise<void>;

  /**
   * cdk destroy
   */
  destroy(options: DestroyOptions): Promise<void>;

  /**
   * cdk list
   */
  list(options: ListOptions): Promise<string[]>;

  /**
   * cdk synth fast
   */
  synthFast(options: SynthFastOptions): Promise<void>;

  /**
   * cdk watch
   */
  watch(options: DeployOptions, events?: WatchEvents): Promise<void>;
}

/**
 * Options for synthing and bypassing the CDK CLI
 */
export interface SynthFastOptions {
  /**
   * The command to use to execute the app.
   * This is typically the same thing that normally
   * gets passed to `--app`
   *
   * e.g. "node 'bin/my-app.ts'"
   * or 'go run main.go'
   */
  readonly execCmd: string[];

  /**
   * Emits the synthesized cloud assembly into a directory
   *
   * @default cdk.out
   */
  readonly output?: string;

  /**
   * Additional context
   *
   * @default - no additional context
   */
  readonly context?: Record<string, string>;

  /**
   * Additional environment variables to set in the
   * execution environment
   *
   * @default - no additional env
   */
  readonly env?: { readonly [name: string]: string };
}

/**
 * Additional environment variables to set in the execution environment
 *
 * @deprecated Use raw property bags instead (object literals, `Map<String,Object>`, etc... )
 */
export interface Environment {
  /**
   * This index signature is not usable in non-TypeScript/JavaScript languages.
   *
   * @jsii ignore
   */
  [key: string]: string | undefined;
}

/**
 * AWS CDK client that provides an API to programatically execute the CDK CLI
 * by wrapping calls to exec the CLI
 */
export interface CdkCliWrapperOptions {
  /**
   * The directory to run the cdk commands from
   */
  readonly directory: string;

  /**
   * Additional environment variables to set
   * in the execution environment that will be running
   * the cdk commands
   *
   * @default - no additional env vars
   */
  readonly env?: { [name: string]: string };

  /**
   * The path to the cdk executable
   *
   * @default 'aws-cdk/bin/cdk'
   */
  readonly cdkExecutable?: string;

  /**
   * Show the output from running the CDK CLI
   *
   * @default false
   */
  readonly showOutput?: boolean;
}

/**
 * Provides a programmatic interface for interacting with the CDK CLI by
 * wrapping the CLI with exec
 */
export class CdkCliWrapper implements ICdk {
  private readonly directory: string;
  private readonly env?: { [name: string]: string | undefined };
  private readonly cdk: string;
  private readonly showOutput: boolean;

  constructor(options: CdkCliWrapperOptions) {
    this.directory = options.directory;
    this.env = options.env;
    this.showOutput = options.showOutput ?? false;
    try {
      this.cdk = options.cdkExecutable ?? 'cdk';
    } catch {
      throw new Error(`could not resolve path to cdk executable: "${options.cdkExecutable ?? 'cdk'}"`);
    }
  }

  private validateArgs(options: DefaultCdkOptions): void {
    if (!options.stacks && !options.all) {
      throw new Error('one of "app" or "stacks" must be provided');
    }
  }

  public async list(options: ListOptions): Promise<string[]> {
    const listCommandArgs: string[] = [
      ...renderBooleanArg('long', options.long),
      ...this.createDefaultArguments(options),
    ];

    return exec([this.cdk, 'ls', ...listCommandArgs], {
      cwd: this.directory,
      verbose: this.showOutput,
      env: this.env,
    }).split('\n');
  }
  /**
   * cdk deploy
   */
  public async deploy(options: DeployOptions): Promise<void> {
    const deployCommandArgs: string[] = [
      ...renderBooleanArg('ci', options.ci),
      ...renderBooleanArg('execute', options.execute),
      ...renderBooleanArg('exclusively', options.exclusively),
      ...renderBooleanArg('force', options.force),
      ...renderBooleanArg('previous-parameters', options.usePreviousParameters),
      ...renderBooleanArg('rollback', options.rollback),
      ...renderBooleanArg('staging', options.staging),
      ...options.reuseAssets ? renderArrayArg('--reuse-assets', options.reuseAssets) : [],
      ...options.notificationArns ? renderArrayArg('--notification-arns', options.notificationArns) : [],
      ...options.parameters ? renderMapArrayArg('--parameters', options.parameters) : [],
      ...options.outputsFile ? ['--outputs-file', options.outputsFile] : [],
      ...options.requireApproval ? ['--require-approval', options.requireApproval] : [],
      ...options.changeSetName ? ['--change-set-name', options.changeSetName] : [],
      ...options.toolkitStackName ? ['--toolkit-stack-name', options.toolkitStackName] : [],
      ...options.progress ? ['--progress', options.progress] : ['--progress', StackActivityProgress.EVENTS],
      ...options.deploymentMethod ? ['--method', options.deploymentMethod] : [],
      ...options.concurrency ? ['--concurrency', options.concurrency.toString()] : [],
      ...this.createDefaultArguments(options),
    ];

    exec([this.cdk, 'deploy', ...deployCommandArgs], {
      cwd: this.directory,
      verbose: this.showOutput,
      env: this.env,
    });
  }

  public async watch(options: DeployOptions, events: WatchEvents = {}): Promise<void> {
    let hotswap: string;
    switch (options.hotswap) {
      case HotswapMode.FALL_BACK:
        hotswap = '--hotswap-fallback';
        break;
      case HotswapMode.HOTSWAP_ONLY:
        hotswap = '--hotswap';
        break;
      default:
        hotswap = '--hotswap-fallback';
        break;
    }
    const deployCommandArgs: string[] = [
      '--watch',
      ...renderBooleanArg('ci', options.ci),
      ...renderBooleanArg('execute', options.execute),
      ...renderBooleanArg('exclusively', options.exclusively),
      ...renderBooleanArg('force', options.force),
      ...renderBooleanArg('previous-parameters', options.usePreviousParameters),
      ...renderBooleanArg('rollback', options.rollback),
      ...renderBooleanArg('staging', options.staging),
      ...renderBooleanArg('logs', options.traceLogs),
      hotswap,
      ...options.reuseAssets ? renderArrayArg('--reuse-assets', options.reuseAssets) : [],
      ...options.notificationArns ? renderArrayArg('--notification-arns', options.notificationArns) : [],
      ...options.parameters ? renderMapArrayArg('--parameters', options.parameters) : [],
      ...options.outputsFile ? ['--outputs-file', options.outputsFile] : [],
      ...options.requireApproval ? ['--require-approval', options.requireApproval] : [],
      ...options.changeSetName ? ['--change-set-name', options.changeSetName] : [],
      ...options.toolkitStackName ? ['--toolkit-stack-name', options.toolkitStackName] : [],
      ...options.progress ? ['--progress', options.progress] : ['--progress', StackActivityProgress.EVENTS],
      ...options.deploymentMethod ? ['--method', options.deploymentMethod] : [],
      ...this.createDefaultArguments(options),
    ];

    const child = watch([this.cdk, 'deploy', ...deployCommandArgs], {
      cwd: this.directory,
      verbose: this.showOutput,
      env: this.env,
    });

    if (events.onStdout) {
      child.stdout?.on('data', events.onStdout);
    }
    if (events.onStderr) {
      child.stderr?.on('data', events.onStderr);
    }

    child.on('close', (code) => {
      child.stdin?.end();
      if (events.onClose) {
        events.onClose(code);
      }
    });
  }

  /**
   * cdk destroy
   */
  public async destroy(options: DestroyOptions): Promise<void> {
    const destroyCommandArgs: string[] = [
      ...renderBooleanArg('force', options.force),
      ...renderBooleanArg('exclusively', options.exclusively),
      ...this.createDefaultArguments(options),
    ];

    exec([this.cdk, 'destroy', ...destroyCommandArgs], {
      cwd: this.directory,
      verbose: this.showOutput,
      env: this.env,
    });
  }

  /**
   * cdk synth
   */
  public async synth(options: SynthOptions): Promise<void> {
    const synthCommandArgs: string[] = [
      ...renderBooleanArg('validation', options.validation),
      ...renderBooleanArg('quiet', options.quiet),
      ...renderBooleanArg('exclusively', options.exclusively),
      ...this.createDefaultArguments(options),
    ];

    exec([this.cdk, 'synth', ...synthCommandArgs], {
      cwd: this.directory,
      verbose: this.showOutput,
      env: this.env,
    });
  }

  /**
   * Do a CDK synth, mimicking the CLI (without actually using it)
   *
   * The CLI has a pretty slow startup time because of all the modules it needs to load,
   * Bypass it to be quicker!
   */
  public async synthFast(options: SynthFastOptions): Promise<void> {
    exec(options.execCmd, {
      cwd: this.directory,
      verbose: this.showOutput,
      env: {
        CDK_CONTEXT_JSON: JSON.stringify(options.context),
        CDK_OUTDIR: options.output,
        ...this.env,
        ...options.env,
      },
    });
  }

  private createDefaultArguments(options: DefaultCdkOptions): string[] {
    this.validateArgs(options);
    const stacks = options.stacks ?? [];
    return [
      ...options.app ? ['--app', options.app] : [],
      ...renderBooleanArg('strict', options.strict),
      ...renderBooleanArg('trace', options.trace),
      ...renderBooleanArg('lookups', options.lookups),
      ...renderBooleanArg('ignore-errors', options.ignoreErrors),
      ...renderBooleanArg('json', options.json),
      ...renderBooleanArg('verbose', options.verbose),
      ...renderBooleanArg('debug', options.debug),
      ...renderBooleanArg('ec2creds', options.ec2Creds),
      ...renderBooleanArg('version-reporting', options.versionReporting),
      ...renderBooleanArg('path-metadata', options.pathMetadata),
      ...renderBooleanArg('asset-metadata', options.assetMetadata),
      ...renderBooleanArg('notices', options.notices),
      ...renderBooleanArg('color', options.color),
      ...options.context ? renderMapArrayArg('--context', options.context) : [],
      ...options.profile ? ['--profile', options.profile] : [],
      ...options.proxy ? ['--proxy', options.proxy] : [],
      ...options.caBundlePath ? ['--ca-bundle-path', options.caBundlePath] : [],
      ...options.roleArn ? ['--role-arn', options.roleArn] : [],
      ...options.output ? ['--output', options.output] : [],
      ...stacks,
      ...options.all ? ['--all'] : [],
    ];
  }
}

function renderMapArrayArg(flag: string, parameters: { [name: string]: string | undefined }): string[] {
  const params: string[] = [];
  for (const [key, value] of Object.entries(parameters)) {
    params.push(`${key}=${value}`);
  }
  return renderArrayArg(flag, params);
}

function renderArrayArg(flag: string, values?: string[]): string[] {
  let args: string[] = [];
  for (const value of values ?? []) {
    args.push(flag, value);
  }
  return args;
}

function renderBooleanArg(val: string, arg?: boolean): string[] {
  if (arg) {
    return [`--${val}`];
  } else if (arg === undefined) {
    return [];
  } else {
    return [`--no-${val}`];
  }
}
