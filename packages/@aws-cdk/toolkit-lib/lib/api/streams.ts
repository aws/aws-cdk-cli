import { Writable } from 'node:stream';

/*
 * Custom writable stream that collects text into a string buffer.
 * Used on classes that take in and directly write to a stream, but
 * we intend to capture the output rather than print.
 */
export class StringWriteStream extends Writable {
  private buffer: string[] = [];

  /**
   * Terminal width in columns.
   * Used by formatTable() to apply width constraints and prevent table overflow.
   */
  public get columns(): number | undefined {
    if (process.stdout.columns !== undefined) {
      return process.stdout.columns;
    }

    const columns = Number(process.env.COLUMNS);
    return Number.isFinite(columns) && Number.isInteger(columns) && columns > 0 ? columns : undefined;
  }

  constructor() {
    super();
  }

  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void): void {
    this.buffer.push(chunk.toString());
    callback();
  }

  toString(): string {
    return this.buffer.join('');
  }
}
