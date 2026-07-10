/** HTTP and SSE contract shared between the web server and the SPA. */

/**
 * SSE event name the server sends (and the SPA listens for) when the cloud
 * assembly is rewritten. It carries no meaningful payload: the server holds no
 * assembly state, so the SPA re-fetches the tree and violations on receipt.
 */
export const ASSEMBLY_CHANGED = 'assembly-changed';

/**
 * SSE event carrying a failed synth's outcome (app-failure or an unclassified
 * error). Fired for both manual and auto synths so the SPA can surface it.
 * Success is not sent here; it arrives as ASSEMBLY_CHANGED.
 */
export const SYNTH_STATUS = 'synth-status';

/** Payload of a {@link SYNTH_STATUS} event: the failure summary and captured stderr. */
export interface SynthStatusEvent {
  readonly message: string;
  readonly details?: string;
}

/** The SSE event names the server may send. */
export type SseEventName = typeof ASSEMBLY_CHANGED | typeof SYNTH_STATUS;

export interface DirEntry {
  readonly name: string;
  /** Path relative to the app directory, usable as the next `dir`/`path` value. POSIX separators. */
  readonly path: string;
  readonly type: 'dir' | 'file';
}

export interface FilesResponse {
  readonly dir: string;
  readonly entries: readonly DirEntry[];
}

export interface FileResponse {
  readonly path: string;
  readonly content: string;
}

/**
 * A construct's source location for the SPA. Mirrors the core `SourceLocation`
 * but with `file` made app-relative (POSIX), so the client can feed it straight
 * back into `/api/file`. Line and column are 1-based, or 0 when only the file
 * is known.
 */
export interface WebSourceLocation {
  /** Source file path relative to the app directory. POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/**
 * A construct tree node as served to the SPA. A trimmed, wire-stable view of
 * the core `ConstructNode`: absolute source paths are relativized to the app
 * directory and nothing internal leaks over the wire.
 */
export interface WebConstructNode {
  /** Construct path, e.g. "MyStack/DataBucket". */
  readonly path: string;
  readonly id: string;
  /** CFN resource type (e.g. "AWS::S3::Bucket"), if this construct is a resource. */
  readonly type?: string;
  /** CFN logical ID, if this construct maps to a resource. */
  readonly logicalId?: string;
  /**
   * Path to the synthesized template that declares this construct's CFN
   * resource, relative to the cloud assembly (`cdk.out`) directory, with POSIX
   * separators. Usually a bare name like "MyStack.template.json", but includes
   * the sub-assembly directory for staged stacks, e.g.
   * "assembly-Prod/Prod-MyStack.template.json". Only set for CFN resources. The
   * core's absolute path is relativized before it crosses the wire.
   */
  readonly templateFile?: string;
  readonly sourceLocation?: WebSourceLocation;
  /**
   * Highest-severity policy-violation label affecting this construct. A folded
   * default child's violations count toward its parent. Absent when the
   * construct has no violation. Used to flag the node in the tree.
   */
  readonly highestSeverity?: string;
  /**
   * Highest severity inherited from any descendant. Set when a child (or
   * deeper) has a violation but this node does not. Lets the tree color
   * ancestor labels so users can drill down to the offending construct.
   */
  readonly inheritedSeverity?: string;
  readonly children: readonly WebConstructNode[];
}

/** Line range within a template (1-based, inclusive on both ends). */
export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

/** Resolved resource metadata returned by `GET /api/template`. */
export interface TemplateResource {
  /** Line range of the resource's value block `{ ... }`. */
  readonly block: LineRange;
  /** User source location for the construct that owns this resource. */
  readonly source?: WebSourceLocation;
}

/** Response for `GET /api/template?file=<templateFile>`. */
export interface TemplateResponse {
  readonly content: string;
  readonly resources: Record<string, TemplateResource>;
}

/**
 * Response for `GET /api/tree`. `not-synthesized` means no cloud assembly was
 * found (the user has not run `cdk synth`)
 */
export type TreeResponse =
  | { readonly status: 'ok'; readonly tree: readonly WebConstructNode[]; readonly warnings: readonly string[] }
  | { readonly status: 'not-synthesized' };

/**
 * Severity exactly as reported by CDK policy validation. Unlike the LSP, which
 * collapses these onto its three diagnostic levels, the SPA keeps the full set
 * so the violations panel can distinguish (for example) fatal from error.
 */
export type WebViolationSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'custom';

/**
 * A single construct that triggered a violation, joined to construct-tree data
 * (resolved source location and template file) so a future navigation feature
 * can link to the resource and its source.
 */
export interface WebViolationOccurrence {
  /** Construct path of the offending construct, e.g. "MyStack/MyBucket". */
  readonly constructPath: string;
  /** CFN logical ID of the offending resource, if known. */
  readonly logicalId?: string;
  /**
   * Template that declares the resource, relative to the cloud assembly
   * (`cdk.out`) directory with POSIX separators (see {@link WebConstructNode.templateFile}).
   */
  readonly templateFile?: string;
  /** Resolved user source location; absent for non-TypeScript apps. */
  readonly sourceLocation?: WebSourceLocation;
  /** JSON property paths within the resource that violate the rule. */
  readonly propertyPaths?: readonly string[];
}

/** A policy-validation violation, normalized for the SPA. */
export interface WebViolation {
  readonly ruleName: string;
  readonly description: string;
  /** Severity as reported; absent for plugins (e.g. CfnGuard) that don't emit one. */
  readonly severity?: WebViolationSeverity;
  /** Plugin-specific label when `severity` is "custom". */
  readonly customSeverity?: string;
  /** Validation plugin that produced the violation. */
  readonly source: string;
  /** Suggested fix text, when the plugin provides one. */
  readonly suggestedFix?: string;
  readonly occurrences: readonly WebViolationOccurrence[];
}

/**
 * Response for `GET /api/policy-validation`. `not-synthesized` mirrors the tree
 * endpoint: no cloud assembly was found. When the assembly exists, `violations`
 * is the normalized list (empty when the report is clean or absent).
 */
export type ViolationsResponse =
  | { readonly status: 'ok'; readonly violations: readonly WebViolation[] }
  | { readonly status: 'not-synthesized' };
