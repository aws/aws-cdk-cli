import type * as cxapi from '@aws-cdk/cx-api';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { CloudAssembly } from './cloud-assembly';
import type { ICloudAssemblySource, IReadableCloudAssembly } from '../../lib/api';
import type { IoHelper } from '../../lib/api-private';
import { BorrowedAssembly } from '../../lib/api-private';
import type { SdkProvider } from '../api/aws-auth';
import { GLOBAL_PLUGIN_HOST } from '../cli/singleton-plugin-host';
import { cdkCliErrorName } from '../cli/telemetry/error';
import { CLI_PRIVATE_SPAN } from '../cli/telemetry/messages';
import type { ErrorDetails } from '../cli/telemetry/schema';
import type { Configuration } from '../cli/user-configuration';
import * as contextproviders from '../context-providers';

/**
 * @returns output directory
 */
export type Synthesizer = (aws: SdkProvider, config: Configuration) => Promise<cxapi.CloudAssembly>;

export interface CloudExecutableProps {
  /**
   * Application configuration (settings and context)
   */
  configuration: Configuration;

  /**
   * AWS object (used by synthesizer and contextprovider)
   */
  sdkProvider: SdkProvider;

  /**
   * Messaging helper
   */
  ioHelper: IoHelper;

  /**
   * Callback invoked to synthesize the actual stacks
   */
  synthesizer: Synthesizer;
}

/**
 * Represent the Cloud Executable and the synthesis we can do on it
 */
export class CloudExecutable implements ICloudAssemblySource {
  private _cloudAssembly?: CloudAssembly;

  constructor(private readonly props: CloudExecutableProps) {
  }

  public async produce(): Promise<IReadableCloudAssembly> {
    const synthesisResult = await this.synthesize(true);

    // We must return an `IReadableCloudAssembly` here, but this Cloud Assembly is only used in the context
    // of the CLI and `cli.ts` currently manages its own locking in the "synthesizer" callback function.
    //
    // All the lock-related functions are therefore no-ops.
    return new BorrowedAssembly(synthesisResult.assembly);
  }

  /**
   * Return whether there is an app command from the configuration
   */
  public get hasApp() {
    return !!this.props.configuration.settings.get(['app']);
  }

  /**
   * Synthesize a set of stacks.
   *
   * @param cacheCloudAssembly - whether to cache the Cloud Assembly after it has been first synthesized.
   *   This is 'true' by default, and only set to 'false' for 'cdk watch',
   *   which needs to re-synthesize the Assembly each time it detects a change to the project files
   */
  public async synthesize(cacheCloudAssembly: boolean = true): Promise<CloudAssembly> {
    if (!this._cloudAssembly || !cacheCloudAssembly) {
      this._cloudAssembly = await this.doSynthesize();
    }
    return this._cloudAssembly;
  }

  private async doSynthesize(): Promise<CloudAssembly> {
    // We may need to run the cloud executable multiple times in order to satisfy all missing context
    // (When the executable runs, it will tell us about context it wants to use
    // but it missing. We'll then look up the context and run the executable again, and
    // again, until it doesn't complain anymore or we've stopped making progress).
    let previouslyMissingKeys: Set<string> | undefined;
    const synthSpan = await this.props.ioHelper.span(CLI_PRIVATE_SPAN.SYNTH_ASSEMBLY).begin({});
    let error: ErrorDetails | undefined;
    try {
      while (true) {
        const assembly = await this.props.synthesizer(this.props.sdkProvider, this.props.configuration);

        if (assembly.manifest.missing && assembly.manifest.missing.length > 0) {
          const missingKeys = missingContextKeys(assembly.manifest.missing);

          if (!this.canLookup) {
            throw new ToolkitError(
              'Context lookups have been disabled. '
              + 'Make sure all necessary context is already in \'cdk.context.json\' by running \'cdk synth\' on a machine with sufficient AWS credentials and committing the result. '
              + `Missing context keys: '${Array.from(missingKeys).join(', ')}'`);
          }

          let tryLookup = true;
          if (previouslyMissingKeys && setsEqual(missingKeys, previouslyMissingKeys)) {
            await this.props.ioHelper.defaults.debug('Not making progress trying to resolve environmental context. Giving up.');
            tryLookup = false;
          }

          previouslyMissingKeys = missingKeys;

          if (tryLookup) {
            await this.props.ioHelper.defaults.debug('Some context information is missing. Fetching...');

            const updates = await contextproviders.provideContextValues(
              assembly.manifest.missing,
              this.props.sdkProvider,
              GLOBAL_PLUGIN_HOST,
              this.props.ioHelper,
            );

            for (const [key, value] of Object.entries(updates)) {
              this.props.configuration.context.set(key, value);
            }

            // Cache the new context to disk
            await this.props.configuration.saveContext();

            // Execute again
            continue;
          }
        }
        return new CloudAssembly(assembly, this.props.ioHelper);
      }
    } catch (e: any) {
      error = {
        name: cdkCliErrorName(e.name),
      };
      throw e;
    } finally {
      await synthSpan.end({ error });
    }
  }

  private get canLookup() {
    return !!(this.props.configuration.settings.get(['lookups']) ?? true);
  }
}

/**
 * Return all keys of missing context items
 */
function missingContextKeys(missing?: cxapi.MissingContext[]): Set<string> {
  return new Set((missing || []).map(m => m.key));
}

function setsEqual<A>(a: Set<A>, b: Set<A>) {
  if (a.size !== b.size) {
    return false;
  }
  for (const x of a) {
    if (!b.has(x)) {
      return false;
    }
  }
  return true;
}
