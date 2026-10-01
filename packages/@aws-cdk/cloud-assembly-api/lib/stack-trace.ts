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

    return {
      fileName,
      functionName,
      sourceLocation,
    };
  }

  constructor(
    /**
     * Name of the function this call frame is in
     */
    public readonly functionName: string,

    /**
     * The file name this call frame is in
     */
    public readonly fileName: string,

    /**
     * The line and optionally column number this call frame is in
     *
     * Formatted as `<line> [':' <column>]`.
     */
    public readonly sourceLocation: string,
  ) {

  }
}

