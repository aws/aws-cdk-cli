import { addToColl } from './util';
import type { WebConstructNode } from '../../lib/web-shared/protocol';

/**
 * A construct anchored to a line in a source file, paired with the template
 * coordinates needed to navigate to its resource. Produced by
 * {@link buildSourceAnchorIndex} and consumed by {@link findConstructAtLine}.
 */
export interface FileContents {
  readonly constructSources: Map<number, WebConstructNode[]>;
  readonly logicalIds: Map<string, WebConstructNode>;
}

/**
 * An index of source anchors, organized by file. Each file maps line numbers to the constructs defined on those lines.
 *
 * Indexes both source files and template files.
 */
export class SourceAndTemplateIndex {
  public static fromTree(tree: readonly WebConstructNode[]) {
    const ret = new SourceAndTemplateIndex();
    ret.addTree(tree);
    return ret;
  }

  // TODO: we are treating all files as being in the same namespace but that's actually wrong,
  // source files are w.r.t. the app root and template files are w.r.t. the assembly root.
  private files = new Map<string, FileContents>();
  private constructs = new Map<string, WebConstructNode>();
  private _sourceFiles = new Set<string>();
  private _templateFiles = new Set<string>();

  constructor() {
  }

  public get size() {
    return this.constructs.size;
  }

  public construct(path: string): WebConstructNode | undefined {
    return this.constructs.get(path);
  }

  public get sourceFiles(): ReadonlyArray<string> {
    return Array.from(this._sourceFiles).sort();
  }

  public get templateFiles(): ReadonlyArray<string> {
    return Array.from(this._templateFiles).sort();
  }

  public addTree(tree: readonly WebConstructNode[]) {
    recurse.call(this, tree);

    function recurse(this: SourceAndTemplateIndex, nodes: readonly WebConstructNode[]) {
      for (const node of nodes) {
        this.constructs.set(node.path, node);

        if (node.sourceLocation) {
          this._sourceFiles.add(node.sourceLocation.file);
          let fileAnchors = this.obtainFileAnchors(node.sourceLocation.file);
          addToColl(fileAnchors.constructSources, node.sourceLocation.line, node);
        }
        if (node.templateLocation) {
          this._templateFiles.add(node.templateLocation.file);
          let fileAnchors = this.obtainFileAnchors(node.templateLocation.file);
          fileAnchors.logicalIds.set(node.templateLocation.logicalId, node);
        }
        recurse.call(this, node.children);
      }
    }
  }

  /**
   * Resolve which construct a source line belongs to: the one whose definition is
   * nearest at or above `line`. Source anchors are single lines (a construct's
   * creation line), not ranges, so a construct is treated as owning every line
   * from its definition down to the next construct's. Returns `undefined` when
   * `line` sits above the first construct in the file, or when there are no
   * anchors.
   *
   * When several constructs share the nearest line (a parent and its synthesized
   * children are all anchored to the single `new Xyz(...)` line), the top-most one
   * wins, since that is the construct the user actually authored on that line. The
   * depth-first pre-order of {@link buildSourceAnchorIndex} places it first, so on
   * a tie we keep the earliest match rather than overwriting it.
   *
   * `anchors` must be sorted by line ascending, as produced by
   * {@link buildSourceAnchorIndex}.
   */
  public findBySourceLocation(
    fileName: string,
    line: number,
  ): WebConstructNode | undefined {
    const file = this.files.get(fileName);
    if (!file) {
      return undefined;
    }

    let constructs = file.constructSources.get(line);
    while (constructs === undefined && line > 0) {
      line--;
      constructs = file.constructSources.get(line);
    }

    return constructs?.[0];
  }

  private obtainFileAnchors(file: string): FileContents {
    let fileAnchors = this.files.get(file);
    if (!fileAnchors) {
      fileAnchors = {
        constructSources: new Map<number, WebConstructNode[]>(),
        logicalIds: new Map<string, WebConstructNode>(),
      };
      this.files.set(file, fileAnchors);
    }
    return fileAnchors;
  }
}
