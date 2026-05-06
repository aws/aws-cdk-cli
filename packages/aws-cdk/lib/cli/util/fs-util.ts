import * as fs from 'fs-extra';

export async function tryReadJson(fileName: string): Promise<unknown | undefined> {
  try {
    return await fs.readJson(fileName);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}
