import * as cp from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as glob_ from 'glob';

const glob = util.promisify(glob_.glob);

async function main() {
  const outdir = await fs.mkdtemp(path.join(os.tmpdir(), 'bundling'));
  try {
    const pkgs = ['aws-cdk'];
    // this is a build task, so we are safe either way
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const deps = await Promise.all(pkgs.map(async (p) => [p, await glob(`packages/${p}/dist/js/*.tgz`)] as const));
    for (const [name, xs] of deps) {
      if (xs.length !== 1) {
        throw new Error(`Expected exactly one tarball for ${name}, got ${xs}`);
      }
    }
    const dependencies = Object.fromEntries(deps.map(([name, xs]) => [name, process.cwd() + '/' + xs[0]]));

    // Write a package.json with the top-level dependency
    await fs.writeFile(path.join(outdir, 'package.json'), JSON.stringify({
      name: 'test',
      private: true,
      version: '1.0.0',
      dependencies,
    }));

    // Do an install given this package.json
    cp.execSync('yarn install', { cwd: outdir, stdio: ['ignore', 'inherit', 'inherit'] });

    // Zip up the `node_modules/` directory
    const zipFileName = 'aws-cdk-cli.zip';
    cp.execSync(`zip -q -r ${zipFileName} node_modules/`, { cwd: outdir, stdio: ['ignore', 'inherit', 'inherit'] });

    await fs.mkdir('dist/standalone', { recursive: true });
    await fs.rm(path.join('dist/standalone/', zipFileName), { force: true });
    await fs.rename(path.join(outdir, zipFileName), path.join('dist/standalone/', zipFileName));
  } finally {
    await fs.rm(outdir, { recursive: true, force: true });
  }
}

main().catch(e => {
  // this is effectively a mini-cli
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
