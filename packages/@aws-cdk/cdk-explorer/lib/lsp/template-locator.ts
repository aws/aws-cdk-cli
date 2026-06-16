import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { resolveLogicalIdAtOffset, resolveResourceRange, type ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import { type Location, type Range } from 'vscode-languageserver/node';
import { offsetsToRange } from './positions';
import type { ConstructNode } from '../core/assembly-reader';

/**
 * An editor navigation target: the template file and the range to reveal.
 * Structurally an LSP `Location`, but kept as a named type because it is
 * serialized into the `openResource` CodeLens command's QuickPick arguments
 * (see codelens.ts), where it reads as a domain target rather than a protocol type.
 */
export interface ResourceTarget {
  readonly uri: string;
  readonly range: Range;
}

/**
 * Resolves a construct node to a CFN resource location for an LSP "go to": the
 * range of the resource's block in its synthesized template.
 *
 * Returns `undefined` when the node is not navigable: no resolved template, the
 * template cannot be read, it does not parse, or the logical id is absent.
 */
export function resourceTarget(node: { templateFile?: string; logicalId: string }): ResourceTarget | undefined {
  if (node.templateFile === undefined) {
    return undefined;
  }
  let templateText: string;
  try {
    templateText = fs.readFileSync(node.templateFile, 'utf-8');
  } catch {
    return undefined;
  }
  const block = resolveResourceRange(templateText, node.logicalId);
  if (block === undefined) {
    return undefined;
  }
  return {
    uri: pathToFileURL(node.templateFile).toString(),
    range: offsetsToRange(templateText, block),
  };
}

/**
 * Reverse navigation: resolve a character offset inside a synthesized template to
 * the source location of the construct that produced the enclosing resource.
 *
 * Finds the resource's logical id at `offset`, looks up the owning construct in
 * `index` (matched by both `templateFile` and `logicalId`, since logical ids are
 * only unique within a template), and returns its source location as a zero-width
 * range. Undefined when the offset is not inside a resource, no construct owns it,
 * or the construct has no source location (for example a non-TypeScript app).
 */
export function sourceTargetAtTemplateOffset(
  index: ConstructIndex<ConstructNode>,
  templateFile: string,
  templateText: string,
  offset: number,
): Location | undefined {
  const logicalId = resolveLogicalIdAtOffset(templateText, offset);
  if (logicalId === undefined) {
    return undefined;
  }
  const owner = [...index].find((node) => node.logicalId === logicalId && node.templateFile === templateFile);
  if (owner?.sourceLocation === undefined) {
    return undefined;
  }
  // SourceLocation is 1-based; LSP positions are 0-based.
  const position = { line: owner.sourceLocation.line - 1, character: owner.sourceLocation.column - 1 };
  return {
    uri: pathToFileURL(owner.sourceLocation.file).toString(),
    range: { start: position, end: position },
  };
}
