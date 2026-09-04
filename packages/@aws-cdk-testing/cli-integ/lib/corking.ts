/**
 * Routines for corking stdout and stderr
 */
import * as stream from 'stream';

/**
 * Values that must be scrubbed from any buffered test output
 *
 * Registered values are process-global because `MemoryStream`s are created per test,
 * while credentials are established once per worker process.
 */
const SECRETS = new Set<string>();

/**
 * Register values to be replaced with a placeholder in all buffered output
 */
export function registerSecrets(...values: Array<string>) {
  for (const value of values) {
    SECRETS.add(value);
  }
}

/**
 * Replace every registered secret in the given text with a placeholder
 */
export function redactSecrets(text: string): string {
  let ret = text;
  for (const secret of SECRETS) {
    ret = ret.split(secret).join('<REDACTED>');
  }
  return ret;
}

export class MemoryStream extends stream.Writable {
  private parts = new Array<Buffer>();

  public _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    this.parts.push(chunk);
    callback();
  }

  /**
   * The buffered output, with all registered secrets redacted
   */
  public buffer() {
    return Buffer.from(redactSecrets(Buffer.concat(this.parts).toString()));
  }

  public clear() {
    this.parts.splice(0, this.parts.length);
  }

  public async flushTo(strm: NodeJS.WritableStream): Promise<void> {
    const flushed = strm.write(this.buffer());
    if (!flushed) {
      return new Promise(ok => strm.once('drain', ok));
    }
    return;
  }

  public toString() {
    return this.buffer().toString();
  }
}
