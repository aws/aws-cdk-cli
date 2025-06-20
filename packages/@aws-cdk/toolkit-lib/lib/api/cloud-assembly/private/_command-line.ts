import { ToolkitError } from '../../../toolkit/toolkit-error';

/**
 * Parse a command line into components.
 *
 * On Windows, emulates the behavior of `CommandLineToArgvW`. On Linux, emulates the behavior of a POSIX shell.
 *
 * (See: https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-commandlinetoargvw)
 */
export function parseCommandLine(cmdLine: string, isWindows: boolean = process.platform === 'win32'): string[] {
  return isWindows ? parseCommandLineWindows(cmdLine) : parseCommandLinePosix(cmdLine);
}

/**
 * Parse command line on Windows
 *
 * @see https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments?view=msvc-170
 */
function parseCommandLineWindows(commandLine: string): string[] {
  const ret: string[] = [];
  let current = '';
  let quoted = false;
  let backSlashcount = 0;

  for (let i = 0; i < commandLine.length; i++) {
    const c = commandLine[i];

    if (c === '\\') {
      backSlashcount += 1;
      continue;
    }

    // We also allow quoting " by doubling it up.
    if (c === '"' && i + 1 < commandLine.length && commandLine[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }

    // Only type of quote is ", and backslashes only behave specially before a "
    if (c === '"') {
      if (backSlashcount % 2 === 0) {
        current += '\\'.repeat(backSlashcount / 2);
        quoted = !quoted;
      } else {
        current += '\\'.repeat(Math.floor(backSlashcount / 2)) + '"';
      }
      backSlashcount = 0;

      continue;
    }

    if (backSlashcount > 0) {
      current += '\\'.repeat(backSlashcount);
      backSlashcount = 0;
    }

    if (quoted) {
      current += c;
      continue;
    }

    if (isWhitespace(c)) {
      if (current) {
        ret.push(current);
      }
      current = '';
      continue;
    }

    current += c;
  }

  if (current) {
    ret.push(current);
  }

  return ret;
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t';
}

function parseCommandLinePosix(commandLine: string): string[] {
  const result: string[] = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < commandLine.length; i++) {
    const char = commandLine[i];

    // Handle escape character
    if (escapeNext) {
      // In double quotes, only certain characters are escaped
      if (inDoubleQuote && !'\\"$`'.includes(char)) {
        current += '\\';
      }
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escapeNext = true;
      continue;
    }

    // Handle quotes
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    // Handle whitespace
    if (!inDoubleQuote && !inSingleQuote && /\s/.test(char)) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  // Add the last argument if there is one
  if (current) {
    result.push(current);
  }

  // Check for unclosed quotes
  if (inDoubleQuote || inSingleQuote) {
    throw new ToolkitError('Unclosed quotes in command line');
  }

  // Check for trailing backslash
  if (escapeNext) {
    throw new ToolkitError('Trailing backslash in command line');
  }

  return result;
}

/**
 * Format a command line in a sensible way
 *
 * The produced string is correct both for Windows and POSIX.
 */
export function formatCommandLine(argv: string[]): string {
  return argv.map(arg => {
    // Empty string needs quotes
    if (arg === '') {
      return '""';
    }

    // If argument contains no problematic characters, return it as-is
    if (/^[a-zA-Z0-9._\-+=/:]+$/.test(arg)) {
      return arg;
    }

    // Windows-style escaping with double quotes
    let escaped = '"';
    let backslashCount = 0;

    for (let i = 0; i < arg.length; i++) {
      const char = arg[i];

      if (char === '\\') {
        // Count consecutive backslashes
        backslashCount++;
      } else if (char === '"') {
        // Double the backslashes before a quote and escape the quote
        escaped += '\\'.repeat(backslashCount * 2 + 1) + '"';
        backslashCount = 0;
      } else {
        // Add accumulated backslashes if any
        if (backslashCount > 0) {
          escaped += '\\'.repeat(backslashCount);
          backslashCount = 0;
        }
        escaped += char;
      }
    }

    // Handle trailing backslashes before the closing quote
    if (backslashCount > 0) {
      escaped += '\\'.repeat(backslashCount * 2);
    }

    escaped += '"';
    return escaped;
  }).join(' ');
}
