/* eslint-disable no-console */
/**
 * Builds the web explorer SPA into lib/web/static, then writes the same assets
 * to lib/web/web-assets.generated.json so they ride the require() graph into
 * the published CLI bundle (static file paths are not bundled).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as esbuild from 'esbuild';

const packageRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(packageRoot, 'frontend', 'src');
const outDir = path.join(packageRoot, 'lib', 'web', 'static');
const embeddedAssetsFile = path.join(packageRoot, 'lib', 'web', 'web-assets.generated.ts');

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });

  const isWatch = process.argv[2] === '--watch';

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
    minify: !isWatch,
    logStyle: 'default',
  });

  try {
    await buildAndPostProcess();

    if (isWatch) {
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
      writeEmbeddedAssets();
      console.log('Built');
    } catch (e) {
      console.error(e);
    }
  }
}

const BUNDLE_FILES = ['bundle.js', 'bundle.css'];
const ASSET_FILES = ['index.html', 'icon.png'];

function writeEmbeddedAssets(): void {
  const assets = [
    ...ASSET_FILES.map(f => [f, fs.readFileSync(path.join(frontendDir, f))] as const),
    ...BUNDLE_FILES.map(f => [f, fs.readFileSync(path.join(outDir, f))] as const),
  ];
  fs.writeFileSync(embeddedAssetsFile, [
    'export const EMBEDDED_ASSETS = {',
    ...assets.map(([fname, buf]) => {
      const containsBinary = buf.indexOf('\x00') !== -1;
      const encoding = containsBinary ? 'base64' : 'utf-8';

      return `  "${fname}": Buffer.from(${JSON.stringify(buf.toString(encoding))}, "${encoding}"),`;
    }),
    '};',
  ].join('\n'), 'utf-8');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
