import type { OffsetRange } from '@aws-cdk/cloud-assembly-api';
import { type Position, type Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Character offsets (from the core range resolver) and LSP positions are two
// coordinate systems over the same text. These convert between them at the LSP
// boundary, using TextDocument so UTF-16 column counting matches the protocol.

/** Convert character offsets into an LSP range (0-based lines, UTF-16 columns). */
export function offsetsToRange(text: string, offsets: OffsetRange): Range {
  const doc = TextDocument.create('', 'json', 0, text);
  return { start: doc.positionAt(offsets.start), end: doc.positionAt(offsets.end) };
}

/** Convert an LSP position into a 0-based character offset. */
export function offsetAtPosition(text: string, position: Position): number {
  return TextDocument.create('', 'json', 0, text).offsetAt(position);
}
