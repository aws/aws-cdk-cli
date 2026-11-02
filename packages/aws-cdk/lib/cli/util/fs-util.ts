import * as fs from 'fs/promises';

export async function tryReadJson(fileName: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(fileName, 'utf-8'));
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}
