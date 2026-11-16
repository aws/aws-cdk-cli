import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IntegManifestReader } from '../../../lib/runner/private/integ-manifest';

describe('Integ manifest reader', () => {
  let tmpDir: string;
  let manifestFile: string;
  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'integ-manifest-test-')));
    manifestFile = path.join(tmpDir, 'integ.json');
    fs.writeFileSync(manifestFile, JSON.stringify({
      version: 'v1.0.0',
      testCases: {
        test1: {
          stacks: ['MyStack'],
          diffAssets: false,
        },
        test2: {
          stacks: ['MyOtherStack'],
          diffAssets: true,
        },
      },
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('can read manifest from file', () => {
    expect(() => {
      IntegManifestReader.fromFile(manifestFile);
    }).not.toThrow();
  });

  test('throws if manifest not found', () => {
    expect(() => {
      IntegManifestReader.fromFile('some-other-file');
    }).toThrow(/Cannot read integ manifest 'some-other-file':/);
  });

  test('can read manifest from path', () => {
    expect(() => {
      IntegManifestReader.fromPath(path.dirname(manifestFile));
    }).not.toThrow();
  });

  test('fromPath sets directory correctly', () => {
    const manifest = IntegManifestReader.fromPath(path.dirname(manifestFile));
    expect(manifest.directory).toEqual(tmpDir);
  });

  test('can get stacks from manifest', () => {
    const manifest = IntegManifestReader.fromFile(manifestFile);

    expect(manifest.tests).toEqual({
      testCases: {
        test1: {
          stacks: ['MyStack'],
          diffAssets: false,
        },
        test2: {
          stacks: ['MyOtherStack'],
          diffAssets: true,
        },
      },
      enableLookups: false,
    });
  });
});
