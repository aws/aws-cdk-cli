import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { type Position, type Range } from 'vscode-languageserver/node';
import type { ConstructNode } from '../core/assembly-reader';

/**
 * Locates a resource definition within a synthesized CloudFormation template
 * and returns the 0-based position of its logical-ID key.
 *
 * A logical ID is globally unique and appears as a JSON *key* (`"<id>":`) only
 * in its own resource definition under `Resources`. Every other occurrence
 * (Ref / Fn::GetAtt / DependsOn / Fn::Sub) is a string *value*, never followed
 * by a colon, so anchoring on `"<id>":` selects the definition without matching
 * references -- no JSON parse needed. Operates on synthesized (pretty-printed)
 * templates, where each key sits on its own line.
 *
 * @returns the position of the key's opening quote, or undefined if absent.
 */
export function findLogicalIdPosition(templateText: string, logicalId: string): Position | undefined {
  const keyPattern = new RegExp(`^\\s*"${escapeRegExp(logicalId)}"\\s*:`);
  const lines = templateText.split('\n');
  for (let line = 0; line < lines.length; line++) {
    if (keyPattern.test(lines[line])) {
      return { line, character: lines[line].indexOf('"') };
    }
  }
  return undefined;
}

/** Escapes regex metacharacters so a literal string matches itself. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** An editor navigation target: the template file and the position to reveal. */
export interface ResourceTarget {
  readonly uri: string;
  readonly range: Range;
}

/**
 * Resolves a construct node to the location of its CFN resource in the
 * synthesized template, suitable for an LSP "go to" navigation. Returns
 * undefined when the node has no resolved template or logical ID, when the
 * template can no longer be read , or when the logical ID cannot be located
 * in the template text.
 */
export function resourceTarget(node: Pick<ConstructNode, 'templateFile' | 'logicalId'>): ResourceTarget | undefined {
  if (node.templateFile === undefined || node.logicalId === undefined) {
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
