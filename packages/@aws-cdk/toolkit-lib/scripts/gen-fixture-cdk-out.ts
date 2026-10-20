/**
 * Generate cdk.out directories for test fixtures.
 *
 * Usage: tsx scripts/gen-fixture-cdk-out.ts [fixture-name ...]
 *
 * If no fixture names are given, generates cdk.out for all fixtures
 * that have an index.ts or index.js builder file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MemoryContext, Toolkit } from '../lib';

const FIXTURES_DIR = path.join(__dirname, '..', 'test', '_fixtures');

async function generateFixture(name: string) {
  const fixtureDir = path.join(FIXTURES_DIR, name);
  if (!fs.existsSync(fixtureDir)) {
    throw new Error(`Fixture not found: ${name}`);
  }

  const outdir = path.join(fixtureDir, 'cdk.out');
  fs.rmSync(outdir, { recursive: true, force: true });

  const toolkit = new Toolkit();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const builder = require(path.join(FIXTURES_DIR, name, 'index')).default;
  const source = await toolkit.fromAssemblyBuilder(builder, {
    outdir,
    contextStore: new MemoryContext(),
  });

  // Produce the assembly to trigger synthesis
  const asm = await source.produce();
  await asm.dispose();

  // Clean up lock files
  for (const file of fs.readdirSync(outdir)) {
    if (file.endsWith('.lock')) {
      fs.rmSync(path.join(outdir, file));
    }
  }

  console.log(`✅ ${name}/cdk.out`);
}

async function main() {
  const args = process.argv.slice(2);

  let fixtures: string[];
  if (args.length > 0) {
    fixtures = args;
  } else {
    fixtures = fs.readdirSync(FIXTURES_DIR).filter((name) => {
      const dir = path.join(FIXTURES_DIR, name);
      return fs.statSync(dir).isDirectory()
        && (fs.existsSync(path.join(dir, 'index.ts')) || fs.existsSync(path.join(dir, 'index.js')));
    });
  }

  for (const name of fixtures) {
    await generateFixture(name);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
