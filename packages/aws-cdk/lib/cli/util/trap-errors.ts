import type { IoHelper } from '../../api-private';

/**
 * Run an async callback, swallowing any errors and logging them as debug messages.
 * Use this for code paths that must never break CLI execution.
 */
export async function trapErrors<T>(ioHelper: IoHelper, message: string, cb: () => Promise<T>): Promise<T | undefined> {
  try {
    return await cb();
  } catch (e) {
    await ioHelper.defaults.debug(`${message}: ${e}`);
    return undefined;
  }
}
