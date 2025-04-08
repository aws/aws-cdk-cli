
import type { ICloudAssemblySource } from '../../api/cloud-assembly';
import { StackAssembly } from '../../api/cloud-assembly/private';
import type { SdkProvider, IoHelper } from '../../api/shared-private';

/**
 * Helper struct to pass internal services around.
 */
export interface ToolkitServices {
  sdkProvider: SdkProvider;
  ioHelper: IoHelper;
}

/**
 * Creates a Toolkit internal CloudAssembly from a CloudAssemblySource.
 *
 * The caller assumes ownership of the returned `StackAssembly`, and `dispose()`
 * should be called on this object after use.
 *
 * @param assemblySource the source for the cloud assembly
 * @param cache if the assembly should be cached, default: `true`
 * @returns the CloudAssembly object
 */
export async function assemblyFromSource(ioHelper: IoHelper, assemblySource: ICloudAssemblySource, cache: boolean = true): Promise<StackAssembly> {
  if (assemblySource instanceof StackAssembly) {
    return assemblySource;
  }

  if (cache) {
    const ret = new StackAssembly(await assemblySource.produce(), ioHelper);
    return ret;
  }

  return new StackAssembly(await assemblySource.produce(), ioHelper);
}
