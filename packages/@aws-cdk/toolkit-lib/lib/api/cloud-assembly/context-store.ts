import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { ContextBag } from '../context';
import { Context } from '../context';
import { Settings, TRANSIENT_CONTEXT_KEY } from '../settings';

/**
 * A storage place for context used in synthesis
 */
export interface IContextStore {
  /**
   * Read the context from the context store, plus all updates we have made so far.
   */
  read(): Promise<Record<string, unknown>>;

  /**
   * Commit the given updates to the context store
   *
   * `undefined` is used as a value to indicate that the key needs to be removed.
   *
   * If a context value is an object that is a superset of `{ [TRANSIENT_CONTEXT_KEY]: true }`
   * it *should* be returned by subsequent `read()` operations on this object,
   * but it *should not* be persisted to permanent storage.
   *
   * You can use the `persistableContext()` function to filter a context dictionary
   * down to remove all values that shouldn't be persisted.
   */
  update(updates: Record<string, unknown>): Promise<void>;
}

/**
 * A context store as used by a CDK app.
 *
 * Will source context from the following locations:
 *
 * - Any context values passed to the constructor (expected
 *   to come from the command line, treated as ephemeral).
 * - The `context` key in `<appDirectory>/cdk.json`.
 * - `<appDirectory>/cdk.context.json`.
 * - The `context` key in `~/.cdk.json`.
 *
 * Updates will be written to `<appDirectory>/cdk.context.json`.
 */
export class CdkAppMultiContext implements IContextStore {
  private _context?: Context;
  private configContextFile: string;
  private projectContextFile: string;
  private userConfigFile: string;

  constructor(appDirectory: string, private readonly commandlineContext?: Record<string, unknown>) {
    this.configContextFile = path.join(appDirectory, 'cdk.json');
    this.projectContextFile = path.join(appDirectory, 'cdk.context.json');
    this.userConfigFile = path.join(os.homedir() ?? '/tmp', '.cdk.json');
  }

  public async read(): Promise<Record<string, unknown>> {
    const context = await this.asyncInitialize();
    return context.all;
  }

  public async update(updates: Record<string, unknown>): Promise<void> {
    const context = await this.asyncInitialize();
    for (const [key, value] of Object.entries(updates)) {
      context.set(key, value);
    }

    await context.save(this.projectContextFile);
  }

  /**
   * Initialize the `Context` object
   *
   * This code all exists to reuse code that's already there, to minimize
   * the chances of the new code behaving subtly differently than the
   * old code.
   *
   * It might be most of this is unnecessary now...
   */
  private async asyncInitialize(): Promise<Context> {
    if (this._context) {
      return this._context;
    }

    const contextSources: ContextBag[] = [
      { bag: new Settings(this.commandlineContext, true) },
      {
        fileName: this.configContextFile,
        bag: (await settingsFromFile(this.configContextFile)).subSettings(['context']).makeReadOnly(),
      },
      {
        fileName: this.projectContextFile,
        bag: await settingsFromFile(this.projectContextFile),
      },
      {
        fileName: this.userConfigFile,
        bag: (await settingsFromFile(this.userConfigFile)).subSettings(['context']).makeReadOnly(),
      },
    ];

    this._context = new Context(...contextSources);
    return this._context;
  }
}

/**
 * On-disk context stored in a single file
 */
export class FileContext implements IContextStore {
  private _cache?: Record<string, unknown>;

  constructor(private readonly fileName: string) {
  }

  public async read(): Promise<Record<string, unknown>> {
    if (!this._cache) {
      this._cache = JSON.parse(await fs.readFile(this.fileName, 'utf-8'));
    }
    if (!this._cache || typeof this._cache !== 'object') {
      throw new ToolkitError(`${this.fileName} must contain an object, got: ${JSON.stringify(this._cache)}`);
    }
    return this._cache;
  }

  public async update(updates: Record<string, unknown>): Promise<void> {
    this._cache = {
      ...await this.read(),
      ...updates,
    };

    const persistable = persistableContext(this._cache);
    await fs.writeFile(this.fileName, JSON.stringify(persistable, undefined, 2), 'utf-8');
  }
}

/**
 * An in-memory context store
 */
export class MemoryContext implements IContextStore {
  private context: Record<string, unknown> = {};

  constructor(initialContext?: Record<string, unknown>) {
    this.context = { ...initialContext };
  }

  public read(): Promise<Record<string, unknown>> {
    return Promise.resolve(this.context);
  }

  public update(updates: Record<string, unknown>): Promise<void> {
    this.context = {
      ...this.context,
      ...updates,
    };

    return Promise.resolve();
  }
}

/**
 * Filter the given context, leaving only entries that should be persisted
 */
export function persistableContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(context)
    .filter(([_, value]) => !isTransientValue(value)));
}

function isTransientValue(x: unknown) {
  return x && typeof x === 'object' && (x as any)[TRANSIENT_CONTEXT_KEY];
}

async function settingsFromFile(filename: string): Promise<Settings> {
  try {
    const data = JSON.parse(await fs.readFile(filename, 'utf-8'));
    return new Settings(data);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return new Settings();
    }
    throw e;
  }
}
