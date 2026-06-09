import { type Position } from 'vscode-languageserver/node';

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
