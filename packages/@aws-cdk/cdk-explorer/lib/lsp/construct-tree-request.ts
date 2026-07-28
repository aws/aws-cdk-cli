import { RequestType0 } from 'vscode-languageserver';
import type { SourceLocation } from '../core/source-resolver';

/**
 * Custom LSP request that returns the source-resolved construct tree, flattened
 * to one entry per construct keyed by its tree path.
 *
 * The server already builds this tree from the cloud assembly (for hover,
 * go-to-definition and CodeLens), so this request lets a client -- for example
 * the AWS Toolkit's CDK tree -- overlay source links onto its own construct tree
 * without re-implementing source resolution.
 */
export const GET_CONSTRUCT_TREE_METHOD = 'cdk/getConstructTree';

/** One construct, flattened, with its resolved source location. */
export interface ConstructSourceEntry {
  /** The construct's tree path (as in tree.json); the key a consumer joins on. */
  readonly path: string;
  readonly id: string;
  /** CFN resource type, if this construct is a CloudFormation resource. */
  readonly type?: string;
  /** CFN logical id, if this construct maps to a resource. */
  readonly logicalId?: string;
  /** User source location where the construct was created; undefined when unresolved. */
  readonly sourceLocation?: SourceLocation;
  /** Absolute path to the construct's template, containment-checked; undefined when none. */
  readonly templateFile?: string;
  /**
   * Character offset of the resource's block within `templateFile`, so a client
   * can open the template positioned on the resource. Undefined when there is no
   * template or the resource block can't be located.
   */
  readonly templateOffset?: number;
}

export interface GetConstructTreeResult {
  /** 'no-assembly' when the app has not been synthesized yet (no cdk.out). */
  readonly status: 'ok' | 'no-assembly';
  /** The cdk.out directory the tree was read from. */
  readonly assemblyDir: string;
  /** One entry per construct, in pre-order. Empty when status is 'no-assembly'. */
  readonly entries: readonly ConstructSourceEntry[];
  /** Non-fatal warnings gathered while resolving (e.g. an unparseable source map). */
  readonly warnings: readonly string[];
}

/** No request params: the server serves its single initialized project. */
export const GetConstructTreeRequest = new RequestType0<GetConstructTreeResult, void>(GET_CONSTRUCT_TREE_METHOD);
