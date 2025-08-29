import * as path from 'node:path';
import type { DeployOptions, ICdk, ListOptions, SynthFastOptions, SynthOptions, WatchEvents } from '@aws-cdk/cdk-cli-wrapper';
import type { DefaultCdkOptions, DestroyOptions } from '@aws-cdk/cloud-assembly-schema/lib/integ-tests';
import type { DeploymentMethod, ICloudAssemblySource, IIoHost, IoMessage, IoRequest, NonInteractiveIoHostProps, StackSelector } from '@aws-cdk/toolkit-lib';
import { ExpandStackSelection, MemoryContext, NonInteractiveIoHost, StackSelectionStrategy, Toolkit } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as fs from 'fs-extra';

export interface ToolkitLibEngineOptions {
  /**
   * The directory to run the cdk commands from
   */
  readonly workingDirectory: string;

  /**
   * Additional environment variables to set
   * in the execution environment that will be running
   * the cdk app
   *
   * @default - no additional env vars
   */
  readonly env?: { [name: string]: string };

  /**
   * Show the output from running the CDK CLI
   *
   * @default false
   */
  readonly showOutput?: boolean;
}

/**
 * A runner engine powered directly by the toolkit-lib
 */
export class ToolkitLibRunnerEngine implements ICdk {
  private readonly toolkit: Toolkit;
  private readonly options: ToolkitLibEngineOptions;
  private readonly showOutput: boolean;

  public constructor(options: ToolkitLibEngineOptions) {
    this.options = options;
    this.showOutput = options.showOutput ?? false;

    this.toolkit = new Toolkit({
      ioHost: this.showOutput? new IntegRunnerIoHost() : new NoopIoHost(),
      // @TODO - these options are currently available on the action calls
      // but toolkit-lib needs them at the constructor level.
      // Need to decide what to do with them.
      //
      // Validations
      //  - assemblyFailureAt: options.strict ?? options.ignoreErrors
      // Logging
      //  - options.color
      // SDK
      //  - options.profile
      //  - options.proxy
      //  - options.caBundlePath
    });

    // @TODO - similar to the above, but in toolkit-lib these options would go on the IoHost
    //  - options.quiet
    //  - options.trace
    //  - options.verbose
    //  - options.json
  }

  /**
   * Synthesizes the CDK app through the Toolkit
   */
  public async synth(options: SynthOptions) {
    const cx = await this.cx(options);
    const lock = await this.toolkit.synth(cx, {
      stacks: this.stackSelector(options),
      validateStacks: options.validation,
    });
    await lock.dispose();
  }

  /**
   * Synthesizes the CDK app quickly, by bypassing the Toolkit and just invoking the app command
   */
  public async synthFast(options: SynthFastOptions) {
    const cx = await this.toolkit.fromCdkApp(options.execCmd.join(' '), {
      workingDirectory: this.options.workingDirectory,
      outdir: options.output ? path.join(this.options.workingDirectory, options.output) : undefined,
      contextStore: new MemoryContext(options.context),
      lookups: false,
      resolveDefaultEnvironment: false,
      env: {
        ...this.options.env,
        ...options.env,
      },
      synthOptions: {
        versionReporting: false,
        pathMetadata: false,
        assetMetadata: false,
      },
    });

    try {
      // @TODO - use produce to mimic the current behavior more closely
      const lock = await cx.produce();
      await lock.dispose();
      // We should fix this once we have stabilized toolkit-lib as engine.
      // What we really should do is this:
      // const lock = await this.toolkit.synth(cx, {
      //   validateStacks: false,
      // });
      // await lock.dispose();
    } catch (e: any) {
      if (e.message.includes('Missing context keys')) {
        // @TODO - silently ignore missing context
        // This is actually an undefined case in the old implementation, which doesn't use the toolkit code
        // and won't fail for missing context. To persevere existing behavior, we do the same here.
        // However in future we need to find a way for integ tests to provide context through snapshots.
        return;
      }
      throw e;
    }
  }

  /**
   * Lists the stacks in the CDK app
   */
  public async list(options: ListOptions): Promise<string[]> {
    // @TODO - existing list specific option, doesn't really make sense to support this in the context of integ-runner
    //  - options.long

    const cx = await this.cx(options);
    const stacks = await this.toolkit.list(cx, {
      stacks: this.stackSelector(options),
    });

    return stacks.map(s => s.name);
  }

  /**
   * Deploys the CDK app
   */
  public async deploy(options: DeployOptions) {
    // @TODO - existing deploy specific option, doesn't really make sense to support this in the context of integ-runner
    //  - options.progress

    if (options.watch) {
      return this.watch(options);
    }

    const cx = await this.cx(options);
    await this.toolkit.deploy(cx, {
      roleArn: options.roleArn,
      traceLogs: options.traceLogs,
      stacks: this.stackSelector(options),
      deploymentMethod: this.deploymentMethod(options),
    });
  }

  /**
   * Watches the CDK app for changes and deploys them automatically
   */
  public async watch(options: DeployOptions, events?: WatchEvents) {
    const cx = await this.cx(options);
    try {
      const watcher = await this.toolkit.watch(cx, {
        roleArn: options.roleArn,
        traceLogs: options.traceLogs,
        stacks: this.stackSelector(options),
        deploymentMethod: this.deploymentMethod(options),
      });
      await watcher.waitForEnd();
    } catch (e: unknown) {
      if (events?.onStderr) {
        events.onStderr(String(e));
      }
      if (events?.onClose) {
        events.onClose(1);
      }
      return;
    }

    if (events?.onClose) {
      events.onClose(0);
    }
  }

  /**
   * Destroys the CDK app
   */
  public async destroy(options: DestroyOptions) {
    const cx = await this.cx(options);

    await this.toolkit.destroy(cx, {
      roleArn: options.roleArn,
      stacks: this.stackSelector(options),
      skipAwaitDeletion: options.skipAwaitDeletion,
    });
  }

  /**
   * Creates a Cloud Assembly Source from the provided options.
   */
  private async cx(options: DefaultCdkOptions): Promise<ICloudAssemblySource> {
    if (!options.app) {
      throw new Error('No app provided');
    }

    // check if the app is a path to existing snapshot and then use it as an assembly directory
    const potentialCxPath = path.join(this.options.workingDirectory, options.app);
    if (fs.pathExistsSync(potentialCxPath) && fs.statSync(potentialCxPath).isDirectory()) {
      return this.toolkit.fromAssemblyDirectory(potentialCxPath);
    }

    let outdir;
    if (options.output) {
      outdir = path.join(this.options.workingDirectory, options.output);
    }

    return this.toolkit.fromCdkApp(options.app, {
      workingDirectory: this.options.workingDirectory,
      outdir,
      lookups: options.lookups,
      resolveDefaultEnvironment: false, // not part of the integ-runner contract
      contextStore: new MemoryContext(options.context),
      env: this.options.env,
      synthOptions: {
        debug: options.debug,
        versionReporting: options.versionReporting ?? false,
        pathMetadata: options.pathMetadata ?? false,
        assetMetadata: options.assetMetadata ?? false,
        assetStaging: options.staging,
      },
    });
  }

  /**
   * Creates a StackSelector from the provided options.
   */
  private stackSelector(options: DefaultCdkOptions & { readonly exclusively?: boolean }): StackSelector {
    return {
      strategy: options.all ? StackSelectionStrategy.ALL_STACKS : StackSelectionStrategy.PATTERN_MUST_MATCH,
      patterns: options.stacks ?? ['**'],
      expand: options.exclusively ? ExpandStackSelection.NONE : ExpandStackSelection.UPSTREAM,
    };
  }

  /**
   * Creates a DeploymentMethod from the provided options.
   */
  private deploymentMethod(options: DeployOptions): DeploymentMethod {
    if (options.hotswap && options.hotswap !== 'full-deployment') {
      return {
        method: 'hotswap',
        fallback: options.hotswap === 'fall-back' ? { method: 'change-set' } : undefined,
      };
    }

    return {
      method: options.deploymentMethod ?? 'change-set',
    };
  }
}

/**
 * An IoHost used in the integ-runner to provide non-interactive output
 */
class IntegRunnerIoHost extends NonInteractiveIoHost {
  public constructor(props: NonInteractiveIoHostProps = {}) {
    super({
      ...props,
      isTTY: false,
    });
  }
  public async notify(msg: IoMessage<unknown>): Promise<void> {
    return super.notify({
      ...msg,
      message: chalk.gray(msg.message),
    });
  }
}

/**
 * An IoHost that doesn't do anything
 */
class NoopIoHost implements IIoHost {
  public async notify(): Promise<void> {
  }
  public async requestResponse<T>(msg: IoRequest<unknown, T>): Promise<T> {
    return msg.defaultResponse;
  }
}
