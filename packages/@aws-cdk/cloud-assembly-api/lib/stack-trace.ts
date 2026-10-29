/**
 * Interface for a class that can determine whether a stack frame is interesting to the user or not.
 *
 * The input is a formatted stack frame, as produced by `captureCallStack` and
 * `renderCallStackJustMyCode`. The output is a boolean indicating whether the
 * frame is user code or not.
 */
export interface IStackFrameFinder {
  isInterestingFrame(frame: string): boolean;
}

/**
 * Recognize "actual" call frames by them containing ` (` and ending in `)`.
 *
 * The `node_modules` frames have already been masked away by
 * `renderCallStackJustMyCode` during capture.
 */
export const DEFAULT_USER_CODE_FINDER: IStackFrameFinder = {
  isInterestingFrame(frame: string): boolean {
    return frame.includes(' (') && frame.endsWith(')');
  },
};

export class StackTrace {
  public static fromNewlineSeparatedString(stackTrace: string): StackTrace {
    return new StackTrace(stackTrace.split('\n'));
  }

  constructor(private readonly frames: string[]) {
  }

  /**
   * Return the first user frame from a "Just My Code" call stack
   *
   * With all the NON-"my code" call frames redacted, the top level frame should
   * be the last user frame that is associated with the given call stack.
   */
  public findAndParse(finder: IStackFrameFinder): StackFrame | undefined {
    for (const frame of this.frames) {
      if (finder.isInterestingFrame(frame)) {
        return StackFrame.parse(frame);
      }
    }
    return undefined;
  }

  public findFirstUserFrame(): StackFrame | undefined {
    return this.findAndParse(DEFAULT_USER_CODE_FINDER);
  }

  public renderJustMyCode(indent = true): string[] {
    return renderCallStackJustMyCode(this.frames.map(f => StackFrame.parse(f)), indent);
  }
}

export class StackFrame {
  /**
   * Parse a single line of a stack frame into a structured object
   *
   * This is mostly a NodeJS-flavored string we parse here, except that in
   * a NodeJS stack trace the line would start with `    at `.
   *
   * Parses all of these:
   *
   * ```
   * <function> (<file>:<line>:<col>)
   * <class>.<function> (<file>:<line>:<col>)
   * Object.<anonymous> (<file>:<line>:<col>)
   * <function> [as somethingElse] (<file>:<line>:<col>)
   * new <constructor> (<file>:<line>:<col>)
   * <file>:<line>:<col>
   * ```
   *
   * See https://v8.dev/docs/stack-trace-api#appendix%3A-stack-trace-format
   */
  public static parse(frame: string): StackFrame {
    let fileName;
    let functionName;
    let sourceLocation;

    // line = <function> (<source>) | <source>
    const paren = frame.indexOf('(');
    if (paren) {
      functionName = frame.slice(0, paren - 1);
      frame = frame.slice(paren + 1, -1);
    } else {
      functionName = '<entry>';
    }

    // Object.<anonymous> looks confusing
    if (functionName === 'Object.<anonymous>') {
      functionName = '<anonymous>';
    }

    // Handle potential alias
    let asI = functionName.indexOf(' [as ');
    if (asI > -1) {
      const endOfAlias = functionName.indexOf(']', asI);
      const lastPeriod = functionName.lastIndexOf('.', asI);
      functionName = functionName.slice(0, lastPeriod + 1) + functionName.slice(asI + 5, endOfAlias);
    }

    // line = <file>:<line>:<col>, but file can contain : as well.
    // Grab at most 2 groups of only digits from the end of the string for source location
    const m = frame.match(/(:[0-9]+){0,2}$/);

    fileName = m ? frame.slice(0, -m[0].length) : frame;
    sourceLocation = m ? m[0].slice(1) : '';

    return new StackFrame({
      fileName,
      functionName,
      sourceLocation,
    });
  }

  /**
   * The file name this call frame is in
   */
  public readonly fileName: string;

  /**
   * Name of the function this call frame is in
   */
  public readonly functionName: string;

  /**
   * The line and optionally column number this call frame is in
   *
   * Formatted as `<line> [':' <column>]`.
   */
  public readonly sourceLocation: string;

  constructor(props: {
    fileName: string;
    functionName: string;
    sourceLocation: string;
  }) {
    this.fileName = props.fileName;
    this.functionName = props.functionName;
    this.sourceLocation = props.sourceLocation;
  }

  public get lineLocation() {
    if (!this.sourceLocation) {
      return undefined;
    }
    const parts = this.sourceLocation.split(':');
    const line = parseInt(parts[0], 10);
    const column = parseInt(parts[1], 10);
    return {
      line: isNaN(line) ? undefined : line,
      column: isNaN(column) ? undefined : column,
    };
  }

  public get lineNumber(): number | undefined {
    return this.lineLocation?.line;
  }

  public get columnNumber(): number | undefined {
    return this.lineLocation?.column;
  }
}

// Look for `/node_modules/` followed by either
// - An @ sign, and 2 path segments
// - No @ sign, and 1 path segment
const MODULE_RE = /(\/|\\)node_modules(\/|\\)(@[^/\\]+[/\\][^/\\]+|[^@][^/\\]*)/;

const DECORATOR_RE = /(\/|\\)(prop-injectable|no-box-stack-traces)\./;

/**
 * Renders an array of CallSites nicely, focusing on the user application code
 *
 * We detect "Not My Code" using the following heuristics:
 *
 * - If there is '/node_modules/' in the file path, we assume the call stack is a library and we skip it.
 * - If there is 'node:' in the file path, we assume it is NodeJS internals and we skip it.
 * - We skip (and hide) 'prop-injectable' or 'no-box-stack-traces' in the trace, because those are
 *   constructor decorators that hide what's interesting (and look weird).
 *
 * If `indent` is enabled, we will prefix stack frames of actual files with "  at ", just like
 * Node does for its stack frames.
 */
function renderCallStackJustMyCode(stack: StackFrame[], indent = true): string[] {
  const lines = [];
  let skipped = new Array<{ functionName?: string; fileName: string }>();

  let sawMyCode = false;
  let i = 0;
  while (i < stack.length) {
    const frame = stack[i++];

    if (frame.fileName.match(DECORATOR_RE)) {
      continue;
    }

    const pat = frame.fileName.match(MODULE_RE);
    if (pat) {
      while (i < stack.length && stack[i].fileName.includes(pat[0])) {
        i++;
      }
      // The last stack frame has the function that user code call into.
      skip({ functionName: stack[i - 1].functionName, fileName: pat[3] });
    } else if (frame.fileName.includes('node:')) {
      skip({ fileName: 'node internals' });
      while (i < stack.length && stack[i].fileName.includes('node:')) {
        i++;
      }
    } else if (isHostInternalFrame(frame)) {
      skip({ fileName: 'jsii runtime' });
      while (i < stack.length && isHostInternalFrame(stack[i])) {
        i++;
      }
    } else {
      reportSkipped(true);
      const prefix = indent ? '    at ' : '';
      lines.push(`${prefix}${frame.functionName} (${frame.fileName}:${frame.sourceLocation})`);
      sawMyCode = true;
    }
  }
  reportSkipped(false);

  if (!sawMyCode) {
    lines.push(`${indent ? '    ' : ''}(no user code in ${Error.stackTraceLimit} frames, use --stack-trace-limit to capture more)`);
  }

  return lines;

  function skip(what: typeof skipped[number]) {
    if (!skipped.find(x => x.fileName === what.fileName && x.functionName === what.functionName)) {
      skipped.push(what);
    }
  }

  function reportSkipped(includeFunction: boolean) {
    if (skipped.length > 0) {
      const rendered = skipped.map((s, j) =>
        // Only render the function name of the last frame before user code
        j === skipped.length - 1 && s.functionName && includeFunction ?
          `${s.functionName} in ${s.fileName}` : s.fileName);

      const prefix = indent ? '    ' : '';
      lines.push(`${prefix}...${rendered.join(', ')}...`);
    }
    skipped = [];
  }
}

const JSII_HOST_DIR_NAME_SYM = Symbol.for('jsii.context.hostDirName');

/**
 * Whether the call site comes from the internals of the host that sent us the stack trace
 */
function isHostInternalFrame(frame: StackFrame): boolean {
  const hostDirName = (global as any)[JSII_HOST_DIR_NAME_SYM];
  return hostDirName && frame.fileName.includes(hostDirName);
}

