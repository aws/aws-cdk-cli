import type { DefaultCdkOptions, DestroyOptions as BaseDestroyOptions, DeployOptions as BaseDeployOptions } from '@aws-cdk/cloud-assembly-schema/lib/integ-tests';
import type { DeploymentMethod } from '@aws-cdk/toolkit-lib';

/**
 * Events emitted during watch mode
 */
export type WatchEvents = {
  onStdout?: (chunk: any) => void;
  onStderr?: (chunk: any) => void;
  onClose?: (code: number | null) => void;
};

/**
 * Options to use with cdk synth
 */
export interface SynthOptions {
  /**
   * The command to use to execute the app.
   * This is typically the same thing that normally
   * gets passed to `--app`
   *
   * e.g. "node 'bin/my-app.ts'"
   * or 'go run main.go'
   */
  readonly app: string;

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
 * Options for cdk list
 */
export interface ListOptions extends DefaultCdkOptions {
}

/**
 * Options to use with cdk deploy
 */
export interface DeployOptions extends BaseDeployOptions {
  /**
   * Whether to show CloudWatch logs for hotswapped resources
   * locally in the users terminal
   *
   * @default - false
   */
  readonly traceLogs?: boolean;
}

/**
 * Options to use with cdk watch
 */
export interface WatchOptions extends DeployOptions {
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
 * Options to create a Cloud Assembly
 */
export interface CxOptions extends DefaultCdkOptions {
  /**
   * Resolve the current default environment an provide as environment variables to the app.
   *
   * @default true
   */
  readonly resolveDefaultEnvironment?: boolean;
  /**
   * Additional environment variables
   *
   * These environment variables will be set in addition to the environment
   * variables currently set in the process. A value of `undefined` will
   * unset a particular environment variable.
   */
  readonly env?: Record<string, string | undefined>;
}

/**
 * AWS CDK CLI operations interface
 *
 * This interface defines the contract for CDK operations that can be
 * performed by different engine implementations.
 */
export interface ICdk {
  /**
   * cdk synth
   */
  synth(options: SynthOptions): Promise<void>;

  /**
   * cdk list
   */
  list(options: ListOptions): Promise<string[]>;

  /**
   * cdk deploy
   */
  deploy(options: DeployOptions): Promise<void>;

  /**
   * cdk destroy
   */
  destroy(options: DestroyOptions): Promise<void>;

  /**
   * cdk watch
   */
  watch(options: DeployOptions, events?: WatchEvents): Promise<void>;
}
