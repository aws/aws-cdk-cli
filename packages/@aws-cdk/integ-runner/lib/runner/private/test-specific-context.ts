import * as fs from 'fs/promises';
import * as path from 'path';

const INTEG_CONTEXT_JSON_FILE = 'integ.context.json';
const CDK_JSON_FILE = 'cdk.json';

export type CdkContext = Record<string, unknown>;

const CONTEXT_CACHE = new Map<string, CdkContext | undefined>();

export async function findTestSpecificContext(directory: string): Promise<CdkContext | undefined> {
  const existing = CONTEXT_CACHE.get(directory);
  if (existing) {
    return existing;
  }

  let maybeContext: CdkContext | undefined;

  // Try to load `integ.context.json`
  if (maybeContext === undefined) {
    const contextFile = path.join(directory, INTEG_CONTEXT_JSON_FILE);
    maybeContext = await tryReadJsonFile(contextFile) as CdkContext | undefined;
  }

  // Try to load `cdk.json#context`
  if (maybeContext === undefined) {
    const cdkJsonFile = path.join(directory, CDK_JSON_FILE);
    let maybeCdkJson = await tryReadJsonFile(cdkJsonFile) as { context?: CdkContext } | undefined;
    maybeContext = maybeCdkJson?.context;
  }

  // Try to load from parent directory
  if (maybeContext === undefined) {
    const parentDir = path.dirname(directory);
    if (parentDir !== directory) {
      maybeContext = await findTestSpecificContext(parentDir);
    }
  }

  CONTEXT_CACHE.set(directory, maybeContext);
  return maybeContext;
}

async function tryReadJsonFile(filePath: string): Promise<unknown | undefined> {
  try {
    const content = await fs.readFile(filePath, { encoding: 'utf-8' });
    return JSON.parse(content);
  } catch (e: any) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      return undefined;
    }
    throw e;
  }
}
