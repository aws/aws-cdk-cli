import { StringWriteStream } from '../../lib/api/streams';

describe('StringWriteStream', () => {
  let originalStdoutColumns: number | undefined;
  let originalColumns: string | undefined;

  beforeEach(() => {
    // Save original stdout.columns value
    originalStdoutColumns = process.stdout.columns;
    originalColumns = process.env.COLUMNS;
    delete process.env.COLUMNS;
  });

  afterEach(() => {
    // Restore original stdout.columns value
    if (originalStdoutColumns !== undefined) {
      (process.stdout as any).columns = originalStdoutColumns;
    } else {
      delete (process.stdout as any).columns;
    }

    if (originalColumns !== undefined) {
      process.env.COLUMNS = originalColumns;
    } else {
      delete process.env.COLUMNS;
    }
  });

  test('collects written chunks into a buffer', async () => {
    // GIVEN
    const stream = new StringWriteStream();

    // WHEN
    stream.write('Hello ');
    stream.write('World');
    await new Promise<void>((resolve) => stream.end(resolve));

    // THEN
    expect(stream.toString()).toBe('Hello World');
  });

  test('handles multiple writes correctly', async () => {
    // GIVEN
    const stream = new StringWriteStream();

    // WHEN
    stream.write('First\n');
    stream.write('Second\n');
    stream.write('Third\n');
    await new Promise<void>((resolve) => stream.end(resolve));

    // THEN
    expect(stream.toString()).toBe('First\nSecond\nThird\n');
  });

  test('converts non-string chunks to strings', async () => {
    // GIVEN
    const stream = new StringWriteStream();

    // WHEN
    stream.write(Buffer.from('Buffer content'));
    await new Promise<void>((resolve) => stream.end(resolve));

    // THEN
    expect(stream.toString()).toBe('Buffer content');
  });

  test('sets columns to undefined when neither process.stdout.columns nor COLUMNS is set', () => {
    // GIVEN
    delete (process.stdout as any).columns;
    delete process.env.COLUMNS;

    // WHEN
    const stream = new StringWriteStream();

    // THEN
    expect(stream.columns).toBeUndefined();
  });

  test('returns empty string when nothing has been written', () => {
    // GIVEN
    const stream = new StringWriteStream();

    // THEN
    expect(stream.toString()).toBe('');
  });

  test('handles empty writes', async () => {
    // GIVEN
    const stream = new StringWriteStream();

    // WHEN
    stream.write('');
    stream.write('content');
    stream.write('');
    await new Promise<void>((resolve) => stream.end(resolve));

    // THEN
    expect(stream.toString()).toBe('content');
  });

  test('preserves write order across multiple operations', async () => {
    // GIVEN
    const stream = new StringWriteStream();
    const writes: string[] = [];

    // WHEN
    for (let i = 1; i <= 10; i++) {
      const text = `Line ${i}\n`;
      writes.push(text);
      stream.write(text);
    }

    await new Promise<void>((resolve) => stream.end(resolve));

    // THEN
    expect(stream.toString()).toBe(writes.join(''));
  });

  test('initializes columns from process.stdout.columns when available', () => {
    // GIVEN
    (process.stdout as any).columns = 120;

    // WHEN
    const stream = new StringWriteStream();

    // THEN
    expect(stream.columns).toBe(120);
  });

  test('uses COLUMNS when process.stdout.columns is undefined', () => {
    // GIVEN
    delete (process.stdout as any).columns;
    process.env.COLUMNS = '205';

    // WHEN
    const stream = new StringWriteStream();

    // THEN
    expect(stream.columns).toBe(205);
  });

  test('process.stdout.columns takes precedence over COLUMNS', () => {
    // GIVEN
    (process.stdout as any).columns = 120;
    process.env.COLUMNS = '205';

    // WHEN
    const stream = new StringWriteStream();

    // THEN
    expect(stream.columns).toBe(120);
  });

  test.each(['abc', '0', '-5', '1.5'])('ignores invalid COLUMNS value %p', (columns) => {
    // GIVEN
    delete (process.stdout as any).columns;
    process.env.COLUMNS = columns;

    // WHEN
    const stream = new StringWriteStream();

    // THEN
    expect(stream.columns).toBeUndefined();
  });

  test('columns reflects different terminal widths', () => {
    // Test with 80 columns
    (process.stdout as any).columns = 80;
    const stream80 = new StringWriteStream();
    expect(stream80.columns).toBe(80);

    // Test with 160 columns
    (process.stdout as any).columns = 160;
    const stream160 = new StringWriteStream();
    expect(stream160.columns).toBe(160);

    // Test with narrow terminal
    (process.stdout as any).columns = 40;
    const stream40 = new StringWriteStream();
    expect(stream40.columns).toBe(40);
  });

  test('columns can be read independently of write operations', async () => {
    // GIVEN
    (process.stdout as any).columns = 150;
    const stream = new StringWriteStream();

    // WHEN
    const columnsBefore = stream.columns;
    stream.write('Some text');
    const columnsAfter = stream.columns;

    await new Promise<void>((resolve) => stream.end(resolve));

    // THEN
    expect(columnsBefore).toBe(150);
    expect(columnsAfter).toBe(150);
    expect(stream.toString()).toBe('Some text');
  });

  test('columns getter reflects runtime changes to terminal width', () => {
    // GIVEN
    (process.stdout as any).columns = 100;
    const stream = new StringWriteStream();

    // THEN - initial read
    expect(stream.columns).toBe(100);

    // WHEN - terminal resized to 120
    (process.stdout as any).columns = 120;

    // THEN
    expect(stream.columns).toBe(120);

    // WHEN - terminal resized to 80
    (process.stdout as any).columns = 80;

    // THEN
    expect(stream.columns).toBe(80);

    // WHEN - terminal becomes non-TTY
    delete (process.stdout as any).columns;

    // THEN
    expect(stream.columns).toBeUndefined();
  });
});
