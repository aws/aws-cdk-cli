export function sideBySide(left: string[], sep: string, right: string[]) {
  const width = left.map(x => x.length).reduce((acc, n) => Math.max(acc, n), 0);

  const ret: string[] = [];
  for (let i = 0; i < left.length || i < right.length; i++) {
    const l = i < left.length ? left[i] : ' '.repeat(width);
    const r = i < right.length ? right[i] : '';
    ret.push(`${l}${sep}${r}`);
  }
  return ret;
}

export function wrapText(n: number, text: string): string[] {
  const breakers = [' ', '\n'];

  const ret: string[] = [];
  let lineStart = 0;
  while (lineStart < text.length) {
    let lineEnd = lineStart + n;
    while (lineEnd > lineStart && lineEnd < text.length && !breakers.includes(text[lineEnd])) {
      lineEnd -= 1;
    }
    if (lineEnd === lineStart) {
      // Could not find a space in this line. Seek forward to the first space to get the smallest line overflow
      lineEnd = lineStart + n;
      while (lineEnd < text.length && !breakers.includes(text[lineEnd])) {
        lineEnd += 1;
      }
    }

    ret.push(text.slice(lineStart, lineEnd));
    lineStart = lineEnd + 1;
  }
  return ret;
}

// --- CloudWatch log formatting ---

/**
 * Maximum number of log lines included per CloudWatch Logs context block.
 *
 * The formatter renders the messages array verbatim, so this is the
 * single user-visible cap.
 */
const MAX_LOG_LINES = 50;

/**
 * Trim already-extracted log lines to the set we render.
 *
 * Keeps only the most recent {@link MAX_LOG_LINES} (newer output is more useful for
 * diagnosis) and prepends an "N earlier lines omitted" marker when truncation happened.
 * This is the single truncation point shared by all CloudWatch contexts — the formatter
 * renders the result verbatim.
 */
export function trimToRecentLines(lines: string[]): string[] {
  const messages = lines.slice(-MAX_LOG_LINES);
  const omitted = lines.length - messages.length;
  if (omitted > 0) {
    messages.unshift(`... (${omitted} earlier lines omitted)`);
  }
  return messages;
}

/**
 * Lambda platform log lines (text format) that carry no application signal.
 */
const LAMBDA_PLATFORM_LINE = /^(INIT_START|START RequestId:|END RequestId:|REPORT RequestId:)/;

/**
 * Normalize Lambda CloudWatch log events into readable lines.
 *
 * Lambda emits logs in one of two formats (per the function's `LoggingConfig.LogFormat`):
 * - **Text**: `<timestamp>\t<requestId>\t<LEVEL>\t<message>`, plus platform lines.
 * - **JSON**: one JSON object per event (`{ timestamp, level, message, ... }`).
 *
 * For both we surface `LEVEL  message` (or just the message when there's no level), strip the
 * redundant per-line timestamp/requestId (it's all one invocation), and drop pure platform
 * boilerplate. The level and message are combined into a single rendered line. We never drop
 * application output — failure detail is often logged at INFO (e.g. the cfn-response "Response
 * body" line). Anything we don't recognize passes through verbatim, and the full logs remain
 * available via the console link.
 *
 * This is Lambda-specific; it is not applied to ECS logs, which are arbitrary container output.
 */
export function parseLambdaLogEvents(events: Array<{ message?: string }>): string[] {
  const out: string[] = [];
  for (const e of events) {
    const raw = e.message;
    if (raw == null) {
      continue;
    }
    const normalized = normalizeLambdaLine(raw);
    if (normalized !== undefined) {
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Normalize a single Lambda log line. Returns `undefined` to drop the line (platform noise),
 * or the cleaned-up text to keep.
 */
function normalizeLambdaLine(raw: string): string | undefined {
  const trimmed = raw.trimEnd();

  // JSON-format event: { timestamp, level, message, ... } (one object per line).
  const jsonResult = normalizeJsonLogLine(trimmed);
  if (jsonResult !== undefined) {
    return jsonResult || undefined;
  }

  // Text-format platform boilerplate: drop.
  if (LAMBDA_PLATFORM_LINE.test(trimmed)) {
    return undefined;
  }

  // Text-format app line: `<ISO timestamp>\t<requestId>\t<LEVEL>\t<message>`.
  // Strip the timestamp + requestId prefix; keep `LEVEL message` (or the rest verbatim).
  const parts = trimmed.split('\t');
  if (parts.length >= 4 && /^\d{4}-\d{2}-\d{2}T/.test(parts[0])) {
    const level = parts[2];
    const message = parts.slice(3).join('\t');
    return formatLeveledLine(level, message);
  }

  // Unrecognized (continuation line, plain stdout, etc.) — keep verbatim.
  return trimmed;
}

/**
 * If `line` is a JSON-format Lambda log object, render it as `LEVEL  message` (the level
 * space-padded to a fixed width; or just the message when there's no level). Returns
 * `undefined` when it isn't JSON.
 *
 * Drops JSON platform events (`type`/`record` envelopes for `platform.*`), which carry no
 * application signal.
 */
function normalizeJsonLogLine(line: string): string | undefined {
  if (!line.startsWith('{')) {
    return undefined;
  }
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }

  // Platform events (e.g. { type: 'platform.report', record: {...} }) — drop.
  if (typeof obj.type === 'string' && obj.type.startsWith('platform.')) {
    return '';
  }

  const level = typeof obj.level === 'string' ? obj.level : undefined;
  // Lambda uses `message`; a thrown error envelope uses `errorMessage` (+ optional stackTrace).
  let message: string;
  if (typeof obj.message === 'string') {
    message = obj.message;
  } else if (typeof obj.errorMessage === 'string') {
    message = Array.isArray(obj.stackTrace) ? [obj.errorMessage, ...obj.stackTrace].join('\n') : obj.errorMessage;
  } else {
    // JSON, but not a shape we recognize — render compactly rather than dropping signal.
    message = line;
  }
  return level ? formatLeveledLine(level, message) : message;
}

/**
 * Render a log level and message as `LEVEL  message`, padding the level to a fixed width so
 * lines align in the terminal. Multi-line messages keep their internal newlines.
 */
function formatLeveledLine(level: string, message: string): string {
  return `${level.padEnd(5)} ${message}`;
}

// CloudWatch console uses double-URI-encoding with '$' replacing '%' for the log group in the fragment.
export function cloudWatchLogsConsoleUrl(region: string, logGroup: string): string {
  const encodedLogGroup = encodeURIComponent(encodeURIComponent(logGroup)).replace(/%/g, '$');
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodedLogGroup}`;
}
