/**
 * Builds the web explorer SPA into lib/web/static (typechecked via
 * tsconfig.frontend.json, since esbuild only transpiles), then writes the same
 * assets to lib/web/web-assets.generated.json so they ride the require() graph
 * into the published CLI bundle (express.static paths are not bundled).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';

const packageRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(packageRoot, 'frontend');
const outDir = path.join(packageRoot, 'lib', 'web', 'static');
const embeddedAssetsFile = path.join(packageRoot, 'lib', 'web', 'web-assets.generated.json');

async function main(): Promise<void> {
  typecheck();

  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(frontendDir, 'index.tsx')],
    bundle: true,
    outfile: path.join(outDir, 'bundle.js'),
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl' },
    sourcemap: true,
    logLevel: 'info',
  });

  fs.copyFileSync(path.join(frontendDir, 'index.html'), path.join(outDir, 'index.html'));
  writeEmbeddedAssets();
}

function writeEmbeddedAssets(): void {
  const assets: Record<string, string> = {
    'index.html': fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf-8'),
    'bundle.js': fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf-8'),
    'bundle.css': fs.readFileSync(path.join(outDir, 'bundle.css'), 'utf-8'),
  };
  fs.writeFileSync(embeddedAssetsFile, JSON.stringify(assets));
}

function typecheck(): void {
  execFileSync('tsc', ['--noEmit', '-p', path.join(packageRoot, 'tsconfig.frontend.json')], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
