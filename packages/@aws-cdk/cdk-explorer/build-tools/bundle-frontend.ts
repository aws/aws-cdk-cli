/**
 * Builds the web explorer SPA into lib/web/static, then writes the same assets
 * to lib/web/web-assets.generated.json so they ride the require() graph into
 * the published CLI bundle (static file paths are not bundled).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';

const packageRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(packageRoot, 'frontend');
const outDir = path.join(packageRoot, 'lib', 'web', 'static');
const embeddedAssetsFile = path.join(packageRoot, 'lib', 'web', 'web-assets.generated.json');

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });

  const context = await esbuild.context({
    entryPoints: [path.join(frontendDir, 'index.tsx')],
    bundle: true,
    outfile: path.join(outDir, 'bundle.js'),
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl' },
    sourcemap: 'external', // does not load map automatically, have to attach manually
    logLevel: 'warning',
    minify: true,
    logStyle: 'default',
  });

  try {
    await buildAndPostProcess();

    if (process.argv[2] === '--watch') {
      const watcher = fs.watch(path.resolve(__dirname, '..', 'frontend'), { recursive: true }, async (eventType, filename) => {
        console.log(`File changed: ${filename} (${eventType})`);
        await buildAndPostProcess();
      });

      await new Promise<void>((resolve) => {
        process.on('SIGINT', resolve);
        process.on('SIGTERM', resolve);
      });

      watcher.close();
    }

  } finally {
    await context.dispose();
  }


  async function buildAndPostProcess() {
    try {
      await context.rebuild();
      fs.copyFileSync(path.join(frontendDir, 'index.html'), path.join(outDir, 'index.html'));
      writeEmbeddedAssets();
      console.log('Built');
    } catch (e) {
      console.error(e);
    }
  }
}

function writeEmbeddedAssets(): void {
  const assets: Record<string, string> = {
    'index.html': fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf-8'),
    'bundle.js': fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf-8'),
    'bundle.css': fs.readFileSync(path.join(outDir, 'bundle.css'), 'utf-8'),
  };
  fs.writeFileSync(embeddedAssetsFile, JSON.stringify(assets));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
