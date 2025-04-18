import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import * as fs from 'fs-extra';
import { generateDtsBundle } from 'dts-bundle-generator';

// copy files
const require = createRequire(import.meta.url);
const cliPackage = path.dirname(require.resolve('aws-cdk/package.json'));
const cdkFromCfnPkg = path.dirname(require.resolve('cdk-from-cfn/package.json'));
const serviceSpecPkg = path.dirname(require.resolve('@aws-cdk/aws-service-spec/package.json'));
const copyFromCli = (from, to = undefined) => {
  return fs.copy(path.join(cliPackage, ...from), path.join(process.cwd(), ...(to ?? from)));
};
const copyFromCdkFromCfn = (from, to = undefined) => {
  return fs.copy(path.join(cdkFromCfnPkg, ...from), path.join(process.cwd(), ...(to ?? from)));
};
const copyFromServiceSpec = (from, to = undefined) => {
  return fs.copy(path.join(serviceSpecPkg, ...from), path.join(process.cwd(), ...(to ?? from)));
};

// declaration bundling
dtsBundleLogging(false);
const bundleDeclarations = async (entryPoints) => {
  const results = generateDtsBundle(entryPoints.map(filePath => ({
    filePath,
    output: {
      noBanner: true,
      exportReferencedTypes: false,
    },
  })), { preferredConfigPath: 'tsconfig.dts.json' });

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
  copyFromServiceSpec(['db.json.gz']),
  copyFromCdkFromCfn(['index_bg.wasm'], ['lib', 'index_bg.wasm']),
  copyFromCli(['lib', 'api', 'bootstrap', 'bootstrap-template.yaml']),
]);

// bundle entrypoints from the library packages
const bundle = esbuild.build({
  outdir: 'lib',
  entryPoints: [
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


function dtsBundleLogging(enable) {
  if (enable) {
    const { enableVerbose } = require('dts-bundle-generator/dist/logger');
    enableVerbose();
  }
}
