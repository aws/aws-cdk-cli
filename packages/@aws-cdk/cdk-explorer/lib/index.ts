export const VERSION = '0.0.0';

export { readAssembly } from './core/assembly-reader';
export type { AssemblyData, AssemblyReadResult, ConstructNode } from './core/assembly-reader';
export type { SourceLocation } from './core/source-resolver';

export { startLspServer } from './lsp/main';
export { cdkLspManifest } from './lsp/features';
export { startServer, createLspHandlers } from './lsp/server';
export type { LspHandlers, LspHandlerOptions, LspServerOptions } from './lsp/server';
