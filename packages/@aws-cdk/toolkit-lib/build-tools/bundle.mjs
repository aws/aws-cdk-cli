import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'fs-extra';

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


// This is a build script, we are fine
// eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
const resources = Promise.all([
  copyFromServiceSpec(['db.json.gz']),
  copyFromCdkFromCfn(['index_bg.wasm'], ['lib', 'index_bg.wasm']),
  copyFromCli(['lib', 'api', 'bootstrap', 'bootstrap-template.yaml']),
]);

// Do all the work in parallel
await Promise.all([
  resources,
]);
