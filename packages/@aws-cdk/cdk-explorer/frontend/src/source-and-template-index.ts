import { addToColl } from './util';
import type { WebConstructNode } from '../../lib/web-shared/protocol';

/**
 * A construct anchored to a line in a source file, paired with the template
 * coordinates needed to navigate to its resource. Produced by
 * {@link buildSourceAnchorIndex} and consumed by {@link findConstructAtLine}.
 */
interface SourceFileContents {
  readonly constructSources: Map<number, WebConstructNode[]>;
}

interface TemplateFileContents {
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

  private sourceFiles = new Map<string, SourceFileContents>();
  private templateFiles = new Map<string, TemplateFileContents>();
  private constructs = new Map<string, WebConstructNode>();
  private _sourceFileNames = new Set<string>();
  private _templateFileNames = new Set<string>();

  constructor() {
  }

  public get size() {
    return this.constructs.size;
  }

  public construct(path: string): WebConstructNode | undefined {
    return this.constructs.get(path);
  }

  public get sourceFileNames(): ReadonlyArray<string> {
    return Array.from(this._sourceFileNames).sort();
  }

  public get templateFileNames(): ReadonlyArray<string> {
    return Array.from(this._templateFileNames).sort();
  }

  public addTree(tree: readonly WebConstructNode[]) {
    recurse.call(this, tree);

    function recurse(this: SourceAndTemplateIndex, nodes: readonly WebConstructNode[]) {
      for (const node of nodes) {
        this.constructs.set(node.path, node);

        if (node.sourceLocation) {
          this._sourceFileNames.add(node.sourceLocation.file);
          let fileAnchors = getDefault(this.sourceFiles, node.sourceLocation.file, () => ({
            constructSources: new Map<number, WebConstructNode[]>(),
          }));
          addToColl(fileAnchors.constructSources, node.sourceLocation.line, node);
        }
        if (node.templateLocation) {
          this._templateFileNames.add(node.templateLocation.file);
          let fileAnchors = getDefault(this.templateFiles, node.templateLocation.file, () => ({
            logicalIds: new Map<string, WebConstructNode>(),
          }));
          fileAnchors.logicalIds.set(node.templateLocation.logicalId, node);
        }
        recurse.call(this, node.children);
      }
    }
  }

  public sourceFileConstructs(fileName: string): Record<string, WebConstructNode[]> {
    const file = this.sourceFiles.get(fileName);
    if (!file) {
      return {};
    }

    return Object.fromEntries(file.constructSources);
  }

  public templateConstructs(fileName: string): Record<string, WebConstructNode> {
    const file = this.templateFiles.get(fileName);
    if (!file) {
      return {};
    }

    return Object.fromEntries(file.logicalIds);
  }
}

function getDefault<A, B>(map: Map<A, B>, key: string, defaultValue: () => B): B {
  let value = map.get(key as any);
  if (value === undefined) {
    value = defaultValue();
    map.set(key as any, value);
  }
  return value;
}
