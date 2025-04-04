
import type { ICloudAssemblySource } from '../../api/cloud-assembly';
import { CachedCloudAssemblySource, StackAssembly } from '../../api/cloud-assembly/private';
import { type SdkProvider, type IoHelper, RWLock } from '../../api/shared-private';

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
    const cx = await new CachedCloudAssemblySource(assemblySource).produce();
    const lock = await new RWLock(cx.directory).acquireRead();
    return new StackAssembly(cx, ioHelper, lock);
  }

  const cx = await assemblySource.produce();
  const lock = await new RWLock(cx.directory).acquireRead();
  return new StackAssembly(cx, ioHelper, lock);
}
