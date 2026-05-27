/**
 * Accumulates raw data chunks and yields complete JSON-parsed lines.
 */
export class LineParser<T> {
  private buffer = '';

  public feed(chunk: string): T[] {
    this.buffer += chunk;
    const results: T[] = [];
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          results.push(JSON.parse(line) as T);
        } catch {
          // Malformed line — discard
        }
      }
    }
    return results;
  }

  public prepend(data: string): void {
    this.buffer = data + this.buffer;
  }

  /** Returns any unprocessed data remaining in the buffer */
  public get remainder(): string {
    return this.buffer;
  }
}
