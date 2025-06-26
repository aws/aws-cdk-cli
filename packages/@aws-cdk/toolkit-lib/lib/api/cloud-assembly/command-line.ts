import { ToolkitError } from '../../toolkit/toolkit-error';

type ShellSyntax = 'posix' | 'cmd.exe';

/**
 * Class to help with parsing and formatting command-lines
 *
 * What syntax we recognizing is an attribute of the `parse` and `toString()` operations,
 * NOT of the command line itself. Defaults to the current platform.
 *
 * Because we start with arbitrary shell strings, we may end up stuffing special
 * shell syntax inside an `argv: string[]` array, which doesn't necessarily make
 * a lot of sense. There could be a lot more modeling here to for example tag
 * `argv` elements as literals or bits of shell syntax so we can render them out
 * inert or active.
 *
 * Making this class do all of that correctly is weeks worth of work. Instead,
 * it's going to be mostly concerned with correctly parsing and preserving spaces,
 * so that we can correctly handle command lines with spaces in them on Windows.
 */
export class CommandLine {
  /**
   * Parse a command line into components.
   *
   * - Windows: emulates the behavior of `cmd.exe`.
   * - POSIX: emulates the behavior of a standard POSIX shell.
   *
   * For some insight of the hell this is on Windows, see these links:
   *
   * - <https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-commandlinetoargvw>
   * - <https://daviddeley.com/autohotkey/parameters/parameters.htm#WIN>
   */
  public static parse(cmdLine: string, syntax: ShellSyntax = defaultShellSyntax()) {
    const argv = isWindows(syntax) ? parseCommandLineWindows(cmdLine) : parseCommandLinePosix(cmdLine);
    return new CommandLine(argv);
  }

  constructor(public readonly argv: string[]) {
  }

  /**
   * Render the command line as a string, quoting only whitespace (and quotes)
   *
   * Any other special characters are left in exactly as-is.
   */
  public toStringGrouped(syntax: ShellSyntax = defaultShellSyntax()) {
    if (isWindows(syntax)) {
      return formatCommandLineWindows(this.argv, /^\S+$/);
    } else {
      return formatCommandLinePosix(this.argv, /^\S+$/);
    }
  }

  /**
   * Render the command line as a string, escaping characters that would be interpreted by the shell
   *
   * The command will be a command invocation with literal parameters, nothing else.
   */
  public toStringInert(syntax: ShellSyntax = defaultShellSyntax()) {
    if (isWindows(syntax)) {
      return formatCommandLineWindows(this.argv, /^[a-zA-Z0-9._\-+=/:]+$/);
    } else {
      return formatCommandLinePosix(this.argv, /^[a-zA-Z0-9._\-+=/:^]+$/);
    }
  }

  public toString() {
    return this.toStringGrouped();
  }
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

function isWindows(x: ShellSyntax) {
  return x === 'cmd.exe';
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
 */
function formatCommandLinePosix(argv: string[], componentIsSafe: RegExp): string {
  return argv.map(arg => {
    // Empty string needs quotes
    if (arg === '') {
      return '\'\'';
    }

    // If argument contains no problematic characters, return it as-is
    if (componentIsSafe.test(arg)) {
      return arg;
    }

    const escaped = Array.from(arg).map(char => char === '\'' || char === '\\' ? `\\${char}` : char).join('');
    return `'${escaped}'`;
  }).join(' ');
}

/**
 * Format a command line in a sensible way
 */
function formatCommandLineWindows(argv: string[], componentIsSafe: RegExp): string {
  return argv.map(arg => {
    // Empty string needs quotes
    if (arg === '') {
      return '""';
    }

    // If argument contains no problematic characters, return it as-is
    if (componentIsSafe.test(arg)) {
      return arg;
    }

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

/**
 * @see https://github.com/nodejs/node/blob/b4c5fb4ffbec9f27ba5799070c2e0588b7c7ff0e/lib/child_process.js#L626
 */
function defaultShellSyntax(): ShellSyntax {
  if (process.platform !== 'win32') {
    return 'posix';
  }

  const file = process.env.comspec || 'cmd.exe';
  // '/d /s /c' is used only for cmd.exe.
  if (/^(?:.*\\)?cmd(?:\.exe)?$/i.test(file)) {
    return 'cmd.exe';
  }

  return 'posix';
}
