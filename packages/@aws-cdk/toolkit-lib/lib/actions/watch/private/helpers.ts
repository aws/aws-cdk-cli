/**
 * A list of generic files that normally don't need to be watched.
 * This list is agnostic to the used programming language and should only match files
 * that are unlikely to be valid files in any of the supported languages.
 */
export const WATCH_EXCLUDE_DEFAULTS = [
  // CDK
  'README.md',
  'cdk*.json',
  // JS
  'package*.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'deno.lock',
  // TS
  'tsconfig*.json',
  '**/*.d.ts',
  'test',
  // Python
  'requirements*.txt',
  'source.bat',
  '**/__init__.py',
  '**/__pycache__',
  'tests',
  // C# & F#
  '**/*.sln',
  '**/*.csproj',
  '**/*.fsproj',
  // Go
  'go.mod',
  'go.sum',
  '**/*test.go',
];
