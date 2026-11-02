
import type { SdkProvider } from '../../api/aws-auth/private';
import { CachedCloudAssembly, type ICloudAssemblySource } from '../../api/cloud-assembly';
import { StackAssembly } from '../../api/cloud-assembly/private';
import type { IoHelper } from '../../api/io/private';
import type { PluginHost } from '../../api/plugin';

/**
 * Helper struct to pass internal services around.
 */
export interface ToolkitServices {
  sdkProvider: SdkProvider;
  ioHelper: IoHelper;
  pluginHost: PluginHost;
}

export interface AssemblyFromSourceOptions {
  /** @default true */
  readonly cache?: boolean;

  /** Abort signal to cancel the operation */
  readonly abort?: AbortSignal;
}

/**
 * Creates a Toolkit internal CloudAssembly from a CloudAssemblySource.
 *
 * The caller assumes ownership of the returned `StackAssembly`, and `dispose()`
 * should be called on this object after use.
 *
 * @param assemblySource - the source for the cloud assembly
 * @param cache - if the assembly should be cached, default: `true`
 * @returns the CloudAssembly object
 */
export async function assemblyFromSource(
  ioHelper: IoHelper,
  assemblySource: ICloudAssemblySource,
  options: AssemblyFromSourceOptions = {},
): Promise<StackAssembly> {
  if (assemblySource instanceof StackAssembly) {
    return assemblySource;
  }

  if (options.cache ?? true) {
    return new StackAssembly(new CachedCloudAssembly(await assemblySource.produce({ abort: options.abort })), ioHelper);
  }

  return new StackAssembly(await assemblySource.produce({ abort: options.abort }), ioHelper);
}
