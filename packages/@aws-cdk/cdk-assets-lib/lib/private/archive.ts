// Re-export the shared, bundled `zip` tool from @aws-cdk/tools.
// The bundled files are copied into `./tools/zip/` by a pre-compile task
// (via useTools); see projenrc/tools.ts.
export { zipDirectory } from './tools/zip';
