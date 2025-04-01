
import type { SdkProvider } from '../../api/aws-cdk';
import type { ICloudAssemblySource } from '../../api/cloud-assembly';
import { CachedCloudAssemblySource, StackAssembly } from '../../api/cloud-assembly/private';
import type { IoHelper } from '../../api/shared-private';

/**
 * Helper struct to pass internal services around.
 */
export interface ToolkitServices {
  sdkProvider: SdkProvider;
  ioHelper: IoHelper;
}

/**
 * Creates a Toolkit internal CloudAssembly from a CloudAssemblySource.
 * @param assemblySource the source for the cloud assembly
 * @param cache if the assembly should be cached, default: `true`
 * @returns the CloudAssembly object
 */
export async function assemblyFromSource(ioHelper: IoHelper, assemblySource: ICloudAssemblySource, cache: boolean = true): Promise<StackAssembly> {
  if (assemblySource instanceof StackAssembly) {
    return assemblySource;
  }

  if (cache) {
    return new StackAssembly(await new CachedCloudAssemblySource(assemblySource).produce(), ioHelper);
  }

  return new StackAssembly(await assemblySource.produce(), ioHelper);
}
