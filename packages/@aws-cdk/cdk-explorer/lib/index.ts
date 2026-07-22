export const VERSION = '0.0.0';

export { readAssembly } from './core/assembly-reader';
export type { AssemblyData, AssemblyReadResult, ConstructNode } from './core/assembly-reader';
export type { SourceLocation } from './core/source-resolver';
export { toolkitAssemblyLock } from './core/assembly-lock';
export type { AssemblyLock, AcquireAssemblyLock } from './core/assembly-lock';

export { startLspServer } from './lsp/main';
export { startServer, createLspHandlers } from './lsp/server';
export type { LspHandlers, LspHandlerOptions, LspServerOptions } from './lsp/server';

export { startWebServer } from './web/server';
export type { WebServer, WebServerOptions } from './web/server';
