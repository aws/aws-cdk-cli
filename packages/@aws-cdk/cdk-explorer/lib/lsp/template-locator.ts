import * as fs from 'fs';
import * as path from 'path';
import { type Location, type Range } from 'vscode-languageserver/node';
import { offsetsToRange } from './positions';
import type { AssemblyIndexWithSourceLocations, AssemblyResourceNode } from '../core/assembly-index-with-source-locations';
import { pathToFileURL } from '../core/safe-url';
import { resolveLogicalIdAtOffset, resolveResourceRange } from '../core/template-ranges';

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
export async function resourceTarget(assemblyDir: string, node: AssemblyResourceNode): Promise<ResourceTarget | undefined> {
  const fullAssemblyPath = path.join(assemblyDir, node.cfnResource.assemblyRelativeTemplateFile);
  let templateText: string;
  try {
    templateText = await fs.promises.readFile(fullAssemblyPath, 'utf-8');
  } catch {
    return undefined;
  }
  const block = resolveResourceRange(templateText, node.cfnResource.logicalId);
  if (block === undefined) {
    return undefined;
  }
  return {
    uri: pathToFileURL(fullAssemblyPath).toString(),
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
 * or the construct has no source location (for example a framework-only trace).
 */
export function sourceTargetAtTemplateOffset(
  index: AssemblyIndexWithSourceLocations,
  templateFile: string,
  templateText: string,
  offset: number,
): Location | undefined {
  const logicalId = resolveLogicalIdAtOffset(templateText, offset);
  if (logicalId === undefined) {
    return undefined;
  }
  const owner = index.byTemplateLocation(index.assemblyDir.relative(templateFile), logicalId);
  const sourceLocation = owner ? index.sourceLocationFor(owner) : undefined;
  if (sourceLocation === undefined) {
    return undefined;
  }
  // SourceLocation is 1-based; LSP positions are 0-based.
  const position = { line: sourceLocation.line - 1, character: 0 };
  return {
    uri: pathToFileURL(index.appDir.absolute(sourceLocation.file)).toString(),
    range: { start: position, end: position },
  };
}
