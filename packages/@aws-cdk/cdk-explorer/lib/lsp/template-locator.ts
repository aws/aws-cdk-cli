import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { type Position, type Range } from 'vscode-languageserver/node';

/**
 * 0-based position of a resource's logical-ID key in its synthesized template.
 * A logical ID only appears as a `"<id>":` key in its own definition (every
 * Ref/GetAtt/DependsOn occurrence is a string value, never followed by `:`), so
 * anchoring on the key selects the definition without a JSON parse. Assumes
 * pretty-printed templates (one key per line). Undefined if not found.
 */
function findLogicalIdPosition(templateText: string, logicalId: string): Position | undefined {
  const key = `"${logicalId}"`;
  const lines = templateText.split('\n');
  for (let line = 0; line < lines.length; line++) {
    const trimmed = lines[line].trimStart();
    if (trimmed.startsWith(key) && trimmed.slice(key.length).trimStart().startsWith(':')) {
      return { line, character: lines[line].length - trimmed.length };
    }
  }
  return undefined;
}

/** An editor navigation target: the template file and the position to reveal. */
export interface ResourceTarget {
  readonly uri: string;
  readonly range: Range;
}

/**
 * Resolves a construct node to its CFN resource location for an LSP "go to";
 * undefined when not navigable (no template, unreadable, or id not found).
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
  const position = findLogicalIdPosition(templateText, node.logicalId);
  if (position === undefined) {
    return undefined;
  }
  return {
    uri: pathToFileURL(node.templateFile).toString(),
    range: { start: position, end: position },
  };
}
