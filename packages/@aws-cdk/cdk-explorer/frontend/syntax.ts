/**
 * PrismJS-based syntax tokenizer covering the template formats (JSON, YAML) and
 * every CDK source language (TypeScript, JavaScript, Python, Java, C#, Go).
 * Returns structured tokens per line for our custom line renderer (which handles
 * highlighting, scroll, diagnostics).
 */
import Prism from 'prismjs/components/prism-core';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';

/** Languages the viewer can highlight: template formats plus CDK source languages. */
export type Language = 'json' | 'yaml' | 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'go';

export interface Token {
  readonly type: string | undefined;
  readonly content: string;
}

const GRAMMAR_MAP: Record<Language, Prism.Grammar> = {
  json: Prism.languages.json,
  yaml: Prism.languages.yaml,
  typescript: Prism.languages.typescript,
  javascript: Prism.languages.javascript,
  python: Prism.languages.python,
  java: Prism.languages.java,
  csharp: Prism.languages.csharp,
  go: Prism.languages.go,
};

export function tokenizeLines(code: string, language: Language): Token[][] {
  const grammar = GRAMMAR_MAP[language];
  if (!grammar) {
    return code.split('\n').map((line) => [{ type: undefined, content: line }]);
  }

  const tokens = Prism.tokenize(code, grammar);
  return splitIntoLines(tokens);
}

function splitIntoLines(tokens: Array<string | Prism.Token>): Token[][] {
  const lines: Token[][] = [[]];

  for (const token of tokens) {
    if (typeof token === 'string') {
      const parts = token.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) lines.push([]);
        if (parts[i]) {
          lines[lines.length - 1].push({ type: undefined, content: parts[i] });
        }
      }
    } else {
      flattenToken(token, lines);
    }
  }

  return lines;
}

function flattenToken(token: Prism.Token, lines: Token[][]): void {
  const type = token.type;

  if (typeof token.content === 'string') {
    const parts = token.content.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i]) {
        lines[lines.length - 1].push({ type, content: parts[i] });
      }
    }
  } else if (Array.isArray(token.content)) {
    for (const inner of token.content) {
      if (typeof inner === 'string') {
        const parts = inner.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) lines.push([]);
          if (parts[i]) {
            lines[lines.length - 1].push({ type, content: parts[i] });
          }
        }
      } else {
        flattenToken(inner, lines);
      }
    }
  }
}
