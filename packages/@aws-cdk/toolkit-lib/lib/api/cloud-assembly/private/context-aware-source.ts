import type { MissingContext } from '@aws-cdk/cloud-assembly-schema';
import * as contextproviders from '../../../context-providers';
import type { ToolkitServices } from '../../../toolkit/private';
import { PROJECT_CONTEXT, type Context } from '../../context';
import type { IoHelper } from '../../io/private';
import { IO } from '../../io/private';
import { ToolkitError } from '../../shared-public';
import type { ICloudAssemblySource, IReadableCloudAssembly } from '../types';

export interface ContextAwareCloudAssemblyProps {
  /**
   * AWS object (used by contextprovider)
   * @deprecated context should be moved to the toolkit itself
   */
  readonly services: ToolkitServices;

  /**
   * Application context
   */
  readonly context: Context;

  /**
   * The file used to store application context in (relative to cwd).
   *
   * @default "cdk.context.json"
   */
  readonly contextFile?: string;

  /**
   * Enable context lookups.
   *
   * Producing a `cxapi.CloudAssembly` will fail if this is disabled and context lookups need to be performed.
   *
   * @default true
   */
  readonly lookups?: boolean;
}

/**
 * A CloudAssemblySource that wraps another CloudAssemblySource and runs a lookup loop on it
 *
 * This means that if the underlying CloudAssemblySource produces a manifest
 * with provider queries in it, the `ContextAwareCloudAssemblySource` will
 * perform the necessary context lookups and invoke the underlying
 * `CloudAssemblySource` again with thew missing context information.
 *
 * This is only useful if the underlying `CloudAssemblySource` can respond to
 * this new context information (it must be a CDK app source); if it is just a
 * static directory, then the contents of the assembly won't change in response
 * to context.
 *
 * The context is passed between `ContextAwareCloudAssemblySource` and the wrapped
 * cloud assembly source via a contex file on disk, so the wrapped assembly source
 * should re-read the context file on every invocation.
 */
export class ContextAwareCloudAssemblySource implements ICloudAssemblySource {
  private canLookup: boolean;
  private context: Context;
  private contextFile: string;
  private ioHelper: IoHelper;

  constructor(private readonly source: ICloudAssemblySource, private readonly props: ContextAwareCloudAssemblyProps) {
    this.canLookup = props.lookups ?? true;
    this.context = props.context;
    this.contextFile = props.contextFile ?? PROJECT_CONTEXT; // @todo new feature not needed right now
    this.ioHelper = props.services.ioHelper;
  }

  /**
   * Produce a Cloud Assembly, i.e. a set of stacks
   */
  public async produce(): Promise<IReadableCloudAssembly> {
    // We may need to run the cloud assembly source multiple times in order to satisfy all missing context
    // (When the source producer runs, it will tell us about context it wants to use
    // but it missing. We'll then look up the context and run the executable again, and
    // again, until it doesn't complain anymore or we've stopped making progress).
    let previouslyMissingKeys: Set<string> | undefined;
    while (true) {
      const readableAsm = await this.source.produce();

      const assembly = readableAsm.cloudAssembly;
      if (assembly.manifest.missing && assembly.manifest.missing.length > 0) {
        const missingKeysSet = missingContextKeys(assembly.manifest.missing);
        const missingKeys = Array.from(missingKeysSet);

        if (!this.canLookup) {
          throw new ToolkitError(
            'Context lookups have been disabled. '
            + 'Make sure all necessary context is already in \'cdk.context.json\' by running \'cdk synth\' on a machine with sufficient AWS credentials and committing the result. '
            + `Missing context keys: '${missingKeys.join(', ')}'`);
        }

        let tryLookup = true;
        if (previouslyMissingKeys && equalSets(missingKeysSet, previouslyMissingKeys)) {
          await this.ioHelper.notify(IO.CDK_ASSEMBLY_I0240.msg('Not making progress trying to resolve environmental context. Giving up.', { missingKeys }));
          tryLookup = false;
        }

        previouslyMissingKeys = missingKeysSet;

        if (tryLookup) {
          await this.ioHelper.notify(IO.CDK_ASSEMBLY_I0241.msg('Some context information is missing. Fetching...', { missingKeys }));
          await contextproviders.provideContextValues(
            assembly.manifest.missing,
            this.context,
            this.props.services.sdkProvider,
            this.props.services.pluginHost,
            this.ioHelper,
          );

          // Cache the new context to disk
          await this.ioHelper.notify(IO.CDK_ASSEMBLY_I0042.msg(`Writing updated context to ${this.contextFile}...`, {
            contextFile: this.contextFile,
            context: this.context.all,
          }));
          await this.context.save(this.contextFile);

          // Execute again. Unlock the assembly here so that the producer can acquire
          // a read lock on the directory again.
          await readableAsm._unlock();
          continue;
        }
      }

      return readableAsm;
    }
  }
}

/**
 * Return all keys of missing context items
 */
function missingContextKeys(missing?: MissingContext[]): Set<string> {
  return new Set((missing || []).map(m => m.key));
}

/**
 * Are two sets equal to each other
 */
function equalSets<A>(a: Set<A>, b: Set<A>) {
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
