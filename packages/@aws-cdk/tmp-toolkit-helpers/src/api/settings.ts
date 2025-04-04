import * as os from 'os';
import * as fs_path from 'path';
import * as fs from 'fs-extra';
import { ToolkitError } from './toolkit-error';
import * as util from '../util';

export type SettingsMap = { [key: string]: any };

/**
 * If a context value is an object with this key set to a truthy value, it won't be saved to cdk.context.json
 */
export const TRANSIENT_CONTEXT_KEY = '$dontSaveContext';

/**
 * A single bag of settings
 */
export class Settings {
  public static mergeAll(...settings: Settings[]): Settings {
    let ret = new Settings();
    for (const setting of settings) {
      ret = ret.merge(setting);
    }
    return ret;
  }

  constructor(
    private settings: SettingsMap = {},
    public readonly readOnly = false,
  ) {
  }

  public async save(fileName: string): Promise<this> {
    const expanded = expandHomeDir(fileName);
    await fs.writeJson(expanded, stripTransientValues(this.settings), {
      spaces: 2,
    });
    return this;
  }

  public get all(): any {
    return this.get([]);
  }

  public merge(other: Settings): Settings {
    return new Settings(util.deepMerge(this.settings, other.settings));
  }

  public subSettings(keyPrefix: string[]) {
    return new Settings(this.get(keyPrefix) || {}, false);
  }

  public makeReadOnly(): Settings {
    return new Settings(this.settings, true);
  }

  public clear() {
    if (this.readOnly) {
      throw new ToolkitError('Cannot clear(): settings are readonly');
    }
    this.settings = {};
  }

  public get empty(): boolean {
    return Object.keys(this.settings).length === 0;
  }

  public get(path: string[]): any {
    return util.deepClone(util.deepGet(this.settings, path));
  }

  public set(path: string[], value: any): Settings {
    if (this.readOnly) {
      throw new ToolkitError(`Can't set ${path}: settings object is readonly`);
    }
    if (path.length === 0) {
      // deepSet can't handle this case
      this.settings = value;
    } else {
      util.deepSet(this.settings, path, value);
    }
    return this;
  }

  public unset(path: string[]) {
    this.set(path, undefined);
  }
}

function expandHomeDir(x: string) {
  if (x.startsWith('~')) {
    return fs_path.join(os.homedir(), x.slice(1));
  }
  return x;
}

/**
 * Return all context value that are not transient context values
 */
function stripTransientValues(obj: { [key: string]: any }) {
  const ret: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!isTransientValue(value)) {
      ret[key] = value;
    }
  }
  return ret;
}

/**
 * Return whether the given value is a transient context value
 *
 * Values that are objects with a magic key set to a truthy value are considered transient.
 */
function isTransientValue(value: any) {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as any)[TRANSIENT_CONTEXT_KEY]
  );
}
