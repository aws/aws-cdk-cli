import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import * as fs from 'fs-extra';
import { generateDtsBundle } from 'dts-bundle-generator';

// copy files
const require = createRequire(import.meta.url);
const cliPackage = path.dirname(require.resolve('aws-cdk/package.json'));
const copyFromCli = (from, to = undefined) => {
  return fs.copy(path.join(cliPackage, ...from), path.join(process.cwd(), ...(to ?? from)));
};

// declaration bundling
const bundleDeclarations = async (entryPoints) => {
  const results = generateDtsBundle(entryPoints.map(filePath => ({
    filePath,
    output: {
      noBanner: true,
      exportReferencedTypes: false,
    },
  })), { preferredConfigPath: 'tsconfig.dev.json' });

  const files = [];
  for (const [idx, declaration] of results.entries()) {
    const outputPath = path.format({ ...path.parse(entryPoints[idx]), base: '', ext: '.d.ts' });
    files.push(fs.promises.writeFile(outputPath, declaration));
  }

  return Promise.all(files);
}

// for the shared public API we also need to bundle the types
const declarations = bundleDeclarations(['lib/api/shared-public.ts']);


// This is a build script, we are fine
// eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
const resources = Promise.all([
  copyFromCli(['build-info.json']),
  copyFromCli(['/db.json.gz']),
  copyFromCli(['lib', 'index_bg.wasm']),
  copyFromCli(['lib', 'api', 'bootstrap', 'bootstrap-template.yaml']),

  // cdk init is not yet available in the toolkit-lib
  // copyFromCli(['lib', 'init-templates']),
]);

// bundle entrypoints from the library packages
const bundle = esbuild.build({
  outdir: 'lib',
  entryPoints: [
    'lib/api/aws-cdk.ts',
    'lib/api/shared-public.ts', 
    'lib/api/shared-private.ts', 
    'lib/private/util.ts',
  ],
  target: 'node18',
  platform: 'node',
  packages: 'external',
  sourcemap: true,
  bundle: true,
});

// Do all the work in parallel
await Promise.all([
  bundle,
  resources,
  declarations
]);
