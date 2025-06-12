import * as path from 'node:path';
import type { DeployOptions, ICdk, ListOptions, SynthFastOptions, SynthOptions, WatchEvents } from '@aws-cdk/cdk-cli-wrapper';
import type { DefaultCdkOptions, DestroyOptions } from '@aws-cdk/cloud-assembly-schema/lib/integ-tests';
import type { DeploymentMethod, ICloudAssemblySource, IIoHost, IoMessage, IoRequest, NonInteractiveIoHostProps, StackSelector } from '@aws-cdk/toolkit-lib';
import { ExpandStackSelection, MemoryContext, NonInteractiveIoHost, StackSelectionStrategy, Toolkit } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';

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
      // options.color
      // assemblyFailureAt: options.strict ?? options.ignoreErrors
      // options.profile
      // options.proxy
      // options.caBundlePath
    });

    // IoHost
    // options.quiet // options.trace // options.verbose
    // options.json
  }

  public async synth(options: SynthOptions) {
    const cx = await this.cx(options);
    const lock = await this.toolkit.synth(cx, {
      stacks: this.stackSelector(options),
      validateStacks: options.validation,
    });
    await lock.dispose();
  }

  public async synthFast(options: SynthFastOptions) {
    const cx = await this.toolkit.fromCdkApp(options.execCmd.join(' '), {
      workingDirectory: this.options.workingDirectory,
      outdir: options.output ? path.join(this.options.workingDirectory, options.output) : undefined,
      contextStore: new MemoryContext(options.context),
      lookups: false,
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
      const lock = await this.toolkit.synth(cx, {
        validateStacks: false,
      });
      await lock.dispose();
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

  public async list(options: ListOptions): Promise<string[]> {
    // IoHost
    // options.long

    const cx = await this.cx(options);
    const stacks = await this.toolkit.list(cx, {
      stacks: this.stackSelector(options),
    });

    return stacks.map(s => s.name);
  }

  public async deploy(options: DeployOptions) {
    if (options.watch) {
      return this.watch(options);
    }
    // IoHost
    // options.progress

    const cx = await this.cx(options);
    await this.toolkit.deploy(cx, {
      roleArn: options.roleArn,
      traceLogs: options.traceLogs,
      stacks: this.stackSelector(options),
      deploymentMethod: this.deploymentMethod(options),
    });
  }
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

  public async destroy(options: DestroyOptions) {
    const cx = await this.cx(options);

    await this.toolkit.destroy(cx, {
      roleArn: options.roleArn,
      stacks: this.stackSelector(options),
    });
  }

  private async cx(options: DefaultCdkOptions): Promise<ICloudAssemblySource> {
    if (!options.app) {
      throw new Error('No app provided');
    }

    let outdir;
    if (options.output) {
      outdir = path.join(this.options.workingDirectory, options.output);
    }

    return this.toolkit.fromCdkApp(options.app, {
      workingDirectory: this.options.workingDirectory,
      outdir,
      lookups: options.lookups,
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

  private stackSelector(options: DefaultCdkOptions & { readonly exclusively?: boolean }): StackSelector {
    return {
      strategy: options.all ? StackSelectionStrategy.ALL_STACKS : StackSelectionStrategy.PATTERN_MUST_MATCH,
      patterns: options.stacks ?? ['**'],
      expand: options.exclusively ? ExpandStackSelection.NONE : ExpandStackSelection.UPSTREAM,
    };
  }

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

class NoopIoHost implements IIoHost {
  public constructor() {
  }
  public async notify(): Promise<void> {
  }
  public async requestResponse<T>(msg: IoRequest<unknown, T>): Promise<T> {
    return msg.defaultResponse;
  }
}
