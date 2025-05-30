import { promises as fs } from 'fs';
import * as path from 'path';
import { ToolkitError } from '../toolkit/toolkit-error';

/**
 * A single-writer/multi-reader lock on a directory
 *
 * It uses marker files with PIDs in them as a locking marker; the PIDs will be
 * checked for liveness, so that if the process exits without cleaning up the
 * files the lock is implicitly released.
 *
 * This class is not 100% race safe, but in practice it should be a lot
 * better than the 0 protection we have today.
 */
/* c8 ignore start */ // code paths are unpredictable
export class RWLock {
  private readonly pidString: string;
  private readonly writerFile: string;
  private readCounter = 0;

  constructor(public readonly directory: string) {
    this.pidString = `${process.pid}`;

    this.writerFile = path.join(this.directory, 'synth.lock');
  }

  /**
   * Acquire a writer lock.
   *
   * No other readers or writers must exist for the given directory.
   */
  public async acquireWrite(): Promise<IWriteLock> {
    await this.assertNoOtherWriters();

    const readers = await this._currentReaders();
    if (readers.length > 0) {
      throw new ToolkitError(`Other CLIs (PID=${readers}) are currently reading from ${this.directory}. Invoke the CLI in sequence, or use '--output' to synth into different directories.`);
    }

    await writeFileAtomic(this.writerFile, this.pidString);

    let released = false;
    return {
      release: async () => {
        // Releasing needs a flag, otherwise we might delete a file that some other lock has created in the mean time.
        if (!released) {
          await deleteFile(this.writerFile);
          released = true;
        }
      },
      convertToReaderLock: async () => {
        // Acquire the read lock before releasing the write lock. Slightly less
        // chance of racing!
        const ret = await this.doAcquireRead();
        await deleteFile(this.writerFile);
        return ret;
      },
    };
  }

  /**
   * Acquire a read lock
   *
   * Will fail if there are any writers.
   */
  public async acquireRead(): Promise<IReadLock> {
    await this.assertNoOtherWriters();
    return this.doAcquireRead();
  }

  /**
   * Obtains the name fo a (new) `readerFile` to use. This includes a counter so
   * that if multiple threads of the same PID attempt to concurrently acquire
   * the same lock, they're guaranteed to use a different reader file name (only
   * one thread will ever execute JS code at once, guaranteeing the readCounter
   * is incremented "atomically" from the point of view of this PID.).
   */
  private readerFile(): string {
    return path.join(this.directory, `read.${this.pidString}.${++this.readCounter}.lock`);
  }

  /**
   * Do the actual acquiring of a read lock.
   */
  private async doAcquireRead(): Promise<IReadLock> {
    const readerFile = this.readerFile();
    await writeFileAtomic(readerFile, this.pidString);

    let released = false;
    return {
      release: async () => {
        // Releasing needs a flag, otherwise we might delete a file that some other lock has created in the mean time.
        if (!released) {
          await deleteFile(readerFile);
          released = true;
        }
      },
    };
  }

  private async assertNoOtherWriters() {
    const writer = await this._currentWriter();
    if (writer) {
      throw new ToolkitError(`Another CLI (PID=${writer}) is currently synthing to ${this.directory}. Invoke the CLI in sequence, or use '--output' to synth into different directories.`);
    }
  }

  /**
   * Check the current writer (if any)
   *
   * Publicly accessible for testing purposes. Do not use.
   *
   * @internal
   */
  public async _currentWriter(): Promise<number | undefined> {
    const contents = await readFileIfExists(this.writerFile);
    if (!contents) {
      return undefined;
    }

    const pid = parseInt(contents, 10);
    if (!processExists(pid)) {
      // Do cleanup of a stray file now
      await deleteFile(this.writerFile);
      return undefined;
    }

    return pid;
  }

  /**
   * Check the current readers (if any)
   *
   * Publicly accessible for testing purposes. Do not use.
   *
   * @internal
   */
  public async _currentReaders(): Promise<number[]> {
    const re = /^read\.([^.]+)\.[^.]+\.lock$/;
    const ret = new Array<number>();

    let children;
    try {
      children = await fs.readdir(this.directory, { encoding: 'utf-8' });
    } catch (e: any) {
      // Can't be locked if the directory doesn't exist
      if (e.code === 'ENOENT') {
        return [];
      }
      throw e;
    }

    for (const fname of children) {
      const m = fname.match(re);
      if (m) {
        const pid = parseInt(m[1], 10);
        if (processExists(pid)) {
          ret.push(pid);
        } else {
          // Do cleanup of a stray file now
          await deleteFile(path.join(this.directory, fname));
        }
      }
    }
    return ret;
  }
}
/* c8 ignore stop */

/**
 * An acquired lock
 */
export interface IReadLock {
  /**
   * Release the lock. Can be called more than once.
   */
  release(): Promise<void>;
}

/**
 * An acquired writer lock
 */
export interface IWriteLock extends IReadLock {
  /**
   * Convert the writer lock to a reader lock
   */
  convertToReaderLock(): Promise<IReadLock>;
}

/* c8 ignore start */ // code paths are unpredictable
async function readFileIfExists(filename: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filename, { encoding: 'utf-8' });
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}
/* c8 ignore stop */

let tmpCounter = 0;
/* c8 ignore start */ // code paths are unpredictable
async function writeFileAtomic(filename: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const tmpFile = `${filename}.${process.pid}_${++tmpCounter}`;
  await fs.writeFile(tmpFile, contents, { encoding: 'utf-8' });
  await fs.rename(tmpFile, filename);
}
/* c8 ignore stop */

/* c8 ignore start */ // code paths are unpredictable
async function deleteFile(filename: string) {
  try {
    await fs.unlink(filename);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return;
    }
    throw e;
  }
}
/* c8 ignore stop */

/* c8 ignore start */ // code paths are unpredictable
function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}
/* c8 ignore stop */
