import type { DefaultCdkOptions, DestroyOptions as BaseDestroyOptions, DeployOptions as BaseDeployOptions } from '@aws-cdk/cloud-assembly-schema/lib/integ-tests';

/**
 * Events emitted during watch mode
 */
export type WatchEvents = {
  onStdout?: (chunk: any) => void;
  onStderr?: (chunk: any) => void;
  onClose?: (code: number | null) => void;
};

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
 * Options to use with cdk synth
 */
export interface SynthOptions extends DefaultCdkOptions {
  /**
   * After synthesis, validate stacks with the "validateOnSynth"
   * attribute set (can also be controlled with CDK_VALIDATION)
   *
   * @default true;
   */
  readonly validation?: boolean;

  /**
   * Do not output CloudFormation Template to stdout
   * @default false;
   */
  readonly quiet?: boolean;

  /**
   * Only synthesize the given stack
   *
   * @default false
   */
  readonly exclusively?: boolean;
}

/**
 * Options for cdk list
 */
export interface ListOptions extends DefaultCdkOptions {
  /**
   * Display environment information for each stack
   *
   * @default false
   */
  readonly long?: boolean;
}

/**
 * Hotswap deployment mode
 */
export enum HotswapMode {
  /**
   * Will fall back to CloudFormation when a non-hotswappable change is detected
   */
  FALL_BACK = 'fall-back',

  /**
   * Will not fall back to CloudFormation when a non-hotswappable change is detected
   */
  HOTSWAP_ONLY = 'hotswap-only',

  /**
   * Will not attempt to hotswap anything and instead go straight to CloudFormation
   */
  FULL_DEPLOYMENT = 'full-deployment',
}

/**
 * Supported display modes for stack deployment activity
 */
export enum StackActivityProgress {
  /**
   * Displays a progress bar with only the events for the resource currently being deployed
   */
  BAR = 'bar',

  /**
   * Displays complete history with all CloudFormation stack events
   */
  EVENTS = 'events',
}

/**
 * Deployment method type
 */
export type DeploymentMethod = 'direct' | 'change-set';

/**
 * Options to use with cdk deploy
 */
export interface DeployOptions extends BaseDeployOptions {
  /**
   * Display mode for stack activity events
   *
   * The default in the CLI is StackActivityProgress.BAR, but
   * since the cli-wrapper will most likely be run in automation it makes
   * more sense to set the default to StackActivityProgress.EVENTS
   *
   * @default StackActivityProgress.EVENTS
   */
  readonly progress?: StackActivityProgress;

  /**
   * Whether this 'deploy' command should actually delegate to the 'watch' command.
   *
   * @default false
   */
  readonly watch?: boolean;

  /**
   * Whether to perform a 'hotswap' deployment.
   * A 'hotswap' deployment will attempt to short-circuit CloudFormation
   * and update the affected resources like Lambda functions directly.
   *
   * @default - `HotswapMode.FALL_BACK` for regular deployments, `HotswapMode.HOTSWAP_ONLY` for 'watch' deployments
   */
  readonly hotswap?: HotswapMode;

  /**
   * Whether to show CloudWatch logs for hotswapped resources
   * locally in the users terminal
   *
   * @default - false
   */
  readonly traceLogs?: boolean;

  /**
   * Deployment method
   */
  readonly deploymentMethod?: DeploymentMethod;
}

/**
 * Options for cdk destroy
 */
export type DestroyOptions = BaseDestroyOptions;

/**
 * AWS CDK CLI operations interface
 *
 * This interface defines the contract for CDK operations that can be
 * performed by different engine implementations.
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
