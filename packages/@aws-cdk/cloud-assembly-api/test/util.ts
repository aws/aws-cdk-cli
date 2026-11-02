import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Write a throwaway directory tree and return its path.
 *
 * Keys are paths relative to the new directory (parent dirs are created);
 * object values are JSON-stringified, string values written verbatim so a test
 * can plant malformed JSON. Callers clean up with {@link rimraf}.
 */
export function writeFiles(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caa-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(dir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

/**
 * rm -rf reimplementation, don't want to depend on an NPM package for this
 */
export function rimraf(fsPath: string) {
  try {
    const isDir = fs.lstatSync(fsPath).isDirectory();

    if (isDir) {
      for (const file of fs.readdirSync(fsPath)) {
        rimraf(path.join(fsPath, file));
      }
      fs.rmdirSync(fsPath);
    } else {
      fs.unlinkSync(fsPath);
    }
  } catch (e: any) {
    // We will survive ENOENT
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }
}
