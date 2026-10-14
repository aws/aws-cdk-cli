import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AssemblyIndex } from '@aws-cdk/cloud-assembly-api';
import {
  AssemblyIndexWithSourceLocations,
  type RelativePath,
  type SourceLocation,
} from '../../lib/core/assembly-index-with-source-locations';
import { SourceMapResolver } from '../../lib/core/source-resolver';

/**
 * `reverseMapJs` maps a `.js` location back to the `.ts` it was compiled from,
 * which is what lets the explorer point at authored source rather than at
 * compiler output.
 *
 * Everything crossing this boundary is app-relative (`RelativePath`), both in
 * and out, and every file read is bounded to the app dir — the paths driving
 * those reads come from the cloud assembly, so a tampered `cdk.out` must not be
 * able to make the resolver read outside the project.
 *
 * `_fixtures/source-maps/sample.{ts,js,js.map}` is real `tsc` output: `greet()`
 * sits on line 5 of the `.js` and line 2 of the `.ts`, so a correct mapping is
 * recognisable rather than merely self-consistent.
 */
const FIXTURES = path.join(__dirname, '..', '_fixtures', 'source-maps');
const SAMPLE_MAP = fs.readFileSync(path.join(FIXTURES, 'sample.js.map'), 'utf-8');

/** The compiled body with its `sourceMappingURL` stripped, so each test attaches its own. */
const SAMPLE_JS_BODY = fs
  .readFileSync(path.join(FIXTURES, 'sample.js'), 'utf-8')
  .replace(/\/\/# sourceMappingURL=.*$/m, '')
  .trimEnd();

/** Inside `greet()` in the compiled output. */
const GREET_IN_JS = { line: 5, column: 12 };
/** The same statement in the original TypeScript. */
const GREET_IN_TS = { line: 2, column: 17 };

let appDir: string;

beforeEach(() => {
  // realpath: on macOS os.tmpdir() is a symlink, and the resolver relativizes
  // against appDir, so the two have to agree.
  appDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-srcmap-')));
});

afterEach(() => {
  fs.rmSync(appDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

/** A resolver bound to the fixture app dir. */
async function resolver(): Promise<SourceMapResolver> {
  const index = await AssemblyIndexWithSourceLocations.create({
    appDir,
    assemblyDir: path.join(appDir, 'cdk.out'),
    assemblyIndex: new AssemblyIndex(),
  });
  return new SourceMapResolver(index);
}

function write(relPath: string, contents: string): void {
  const full = path.join(appDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

/** Write a compiled `.js` carrying the given `sourceMappingURL`. */
function writeJs(relPath: string, sourceMappingUrl?: string): void {
  write(relPath, sourceMappingUrl === undefined
    ? SAMPLE_JS_BODY
    : `${SAMPLE_JS_BODY}\n//# sourceMappingURL=${sourceMappingUrl}\n`);
}

/** Copy the original TypeScript to where a map's `sources` will point. */
function writeOriginalTs(relPath: string): void {
  write(relPath, fs.readFileSync(path.join(FIXTURES, 'sample.ts'), 'utf-8'));
}

const at = (file: string, pos: { line: number; column: number }): SourceLocation =>
  ({ file: file as RelativePath, ...pos });

describe('reverseMapJs', () => {
  test('maps a .js location back to the .ts it was compiled from', async () => {
    writeJs('sample.js', 'sample.js.map');
    write('sample.js.map', SAMPLE_MAP);
    writeOriginalTs('sample.ts');

    const resolved = await (await resolver()).reverseMapJs(at('sample.js', GREET_IN_JS));

    // Both line and column move, so this proves a real mapping rather than a
    // filename swap. Columns are 1-based on the way in and out.
    expect(resolved).toEqual(at('sample.ts', GREET_IN_TS));
  });

  test('resolves a map inlined as a data: URI', async () => {
    const inline = Buffer.from(SAMPLE_MAP).toString('base64');
    writeJs('bundled.js', `data:application/json;base64,${inline}`);
    writeOriginalTs('sample.ts');

    const resolved = await (await resolver()).reverseMapJs(at('bundled.js', GREET_IN_JS));

    expect(resolved).toEqual(at('sample.ts', GREET_IN_TS));
  });

  test('resolves an external map under a non-default filename', async () => {
    // The directive is authoritative; the `<js>.map` convention is not assumed.
    writeJs('sample.js', 'weird.name.map');
    write('weird.name.map', SAMPLE_MAP);
    writeOriginalTs('sample.ts');

    const resolved = await (await resolver()).reverseMapJs(at('sample.js', GREET_IN_JS));

    expect(resolved).toEqual(at('sample.ts', GREET_IN_TS));
  });

  test('resolves the map relative to the .js, not the process working directory', async () => {
    // The language server's cwd is wherever the editor spawned it, which is
    // essentially never the project dir, so a cwd-relative resolution would
    // find nothing here.
    writeJs('dist/sample.js', 'sample.js.map');
    write('dist/sample.js.map', SAMPLE_MAP);
    writeOriginalTs('dist/sample.ts');

    const resolved = await (await resolver()).reverseMapJs(at('dist/sample.js', GREET_IN_JS));

    expect(resolved).toEqual(at('dist/sample.ts', GREET_IN_TS));
  });

  test('applies sourceRoot when resolving the original', async () => {
    writeJs('sample.js', 'sample.js.map');
    write('sample.js.map', JSON.stringify({ ...JSON.parse(SAMPLE_MAP), sourceRoot: 'src/' }));
    writeOriginalTs('src/sample.ts');

    const resolved = await (await resolver()).reverseMapJs(at('sample.js', GREET_IN_JS));

    expect(resolved).toEqual(at('src/sample.ts', GREET_IN_TS));
  });

  test('parses each map once across repeated lookups', async () => {
    // One assembly asks for the same map many times, which is the whole reason
    // the resolver is long-lived.
    writeJs('sample.js', 'sample.js.map');
    write('sample.js.map', SAMPLE_MAP);
    writeOriginalTs('sample.ts');
    const subject = await resolver();
    await subject.reverseMapJs(at('sample.js', GREET_IN_JS));

    const readFile = jest.spyOn(fs.promises, 'readFile');
    const again = await subject.reverseMapJs(at('sample.js', GREET_IN_JS));

    expect(readFile).not.toHaveBeenCalled();
    expect(again).toEqual(at('sample.ts', GREET_IN_TS));
  });
});

describe('reverseMapJs passthrough', () => {
  test.each(['app.ts', 'component.tsx'])('returns a %s location unchanged', async (file) => {
    // Already source-space; there is nothing to map and no file to read.
    writeOriginalTs(file);
    const readFile = jest.spyOn(fs.promises, 'readFile');

    const location = at(file, GREET_IN_TS);
    expect(await (await resolver()).reverseMapJs(location)).toEqual(location);
    expect(readFile).not.toHaveBeenCalled();
  });

  test('returns the .js location unchanged when it has no map', async () => {
    writeJs('plain.js');

    const subject = await resolver();
    const location = at('plain.js', GREET_IN_JS);

    expect(await subject.reverseMapJs(location)).toEqual(location);
    // No map is the normal case for plain JS, not something to warn about.
    expect(subject.warnings).toEqual([]);
  });

  test('returns the location unchanged when the .js itself is unreadable', async () => {
    const subject = await resolver();
    const location = at('absent.js', GREET_IN_JS);

    expect(await subject.reverseMapJs(location)).toEqual(location);
    expect(subject.warnings).toEqual([]);
  });

  test('returns the location unchanged when the line is not in the map', async () => {
    writeJs('sample.js', 'sample.js.map');
    write('sample.js.map', SAMPLE_MAP);

    const location = at('sample.js', { line: 999, column: 1 });

    expect(await (await resolver()).reverseMapJs(location)).toEqual(location);
  });
});

describe('reverseMapJs failure reporting', () => {
  test('warns once when a referenced map cannot be parsed', async () => {
    // A broken map must not masquerade as "no source map": silently falling
    // back to .js locations is the confusing outcome.
    writeJs('sample.js', 'sample.js.map');
    write('sample.js.map', '{ not json');
    const subject = await resolver();

    const location = at('sample.js', GREET_IN_JS);
    expect(await subject.reverseMapJs(location)).toEqual(location);
    expect(subject.warnings).toHaveLength(1);
    expect(subject.warnings[0]).toContain('sample.js');
  });

  test('warns when a referenced map is missing', async () => {
    writeJs('sample.js', 'sample.js.map');
    const subject = await resolver();

    await subject.reverseMapJs(at('sample.js', GREET_IN_JS));

    expect(subject.warnings).toHaveLength(1);
  });

  test('refuses a map outside the app dir rather than reading it', async () => {
    // sourceMappingURL comes from the assembly, so it is attacker-influenceable
    // if cdk.out is tampered with.
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-outside-')));
    try {
      fs.writeFileSync(path.join(outside, 'stolen.js.map'), SAMPLE_MAP);
      writeJs('sample.js', path.join('..', path.basename(outside), 'stolen.js.map'));
      const subject = await resolver();

      const location = at('sample.js', GREET_IN_JS);
      expect(await subject.reverseMapJs(location)).toEqual(location);
      expect(subject.warnings).toHaveLength(1);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('keeps resolving other files after one map fails', async () => {
    writeJs('broken.js', 'broken.js.map');
    write('broken.js.map', '{ not json');
    writeJs('good.js', 'good.js.map');
    write('good.js.map', SAMPLE_MAP);
    writeOriginalTs('sample.ts');
    const subject = await resolver();

    await subject.reverseMapJs(at('broken.js', GREET_IN_JS));
    const resolved = await subject.reverseMapJs(at('good.js', GREET_IN_JS));

    expect(resolved).toEqual(at('sample.ts', GREET_IN_TS));
    expect(subject.warnings).toHaveLength(1);
  });
});
