/* eslint-disable @typescript-eslint/no-require-imports */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import type {
  AssemblyManifest,
  StackTagsMetadataEntry,
} from '../lib';
import {
  ArtifactType,
  ContextProvider,
  Manifest,
} from '../lib';

const FIXTURES = path.join(__dirname, 'fixtures');

function fixture(name: string) {
  return path.join(FIXTURES, name, 'manifest.json');
}

test('manifest save', () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-tests'));
  const manifestFile = path.join(outdir, 'manifest.json');

  const assemblyManifest: AssemblyManifest = {
    version: 'version',
    runtime: {
      libraries: { lib1: '1.2.3' },
    },
  };

  Manifest.saveAssemblyManifest(assemblyManifest, manifestFile);

  const saved = JSON.parse(fs.readFileSync(manifestFile, { encoding: 'utf-8' }));

  expect(saved).toEqual(expect.objectContaining({
    ...assemblyManifest,
    version: Manifest.version(), // version is forced
  }));
});

test('manifest contains minimum CLI version', () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-tests'));
  const manifestFile = path.join(outdir, 'manifest.json');

  // This relies on the fact that the cli JSON version file is `require()`d,
  // and that the 'require' below will find the same object in the module cache.
  const cliVersionFile = require(`${__dirname}/../cli-version.json`);
  cliVersionFile.version = '9.9.9';
  try {
    const assemblyManifest: AssemblyManifest = {
      version: 'version',
      runtime: {
        libraries: { lib1: '1.2.3' },
      },
    };

    Manifest.saveAssemblyManifest(assemblyManifest, manifestFile);

    const saved = JSON.parse(fs.readFileSync(manifestFile, { encoding: 'utf-8' }));

    expect(saved.minimumCliVersion).toEqual('9.9.9');
  } finally {
    cliVersionFile.version = '';
  }
});

test('assumeRoleAdditionalOptions.RoleArn is validated in stack artifact', () => {
  expect(() => {
    Manifest.saveAssemblyManifest(
      {
        version: 'version',
        artifacts: {
          'aws-cdk-sqs': {
            type: ArtifactType.AWS_CLOUDFORMATION_STACK,
            properties: {
              directoryName: 'dir',
              file: 'file',
              templateFile: 'template',
              assumeRoleAdditionalOptions: {
                RoleArn: 'foo',
              },
            },
          },
        },
      },
      'somewhere',
    );
  }).toThrow('RoleArn is not allowed inside \'assumeRoleAdditionalOptions\'');
});

test('assumeRoleAdditionalOptions.ExternalId is validated in stack artifact', () => {
  expect(() => {
    Manifest.saveAssemblyManifest(
      {
        version: 'version',
        artifacts: {
          'aws-cdk-sqs': {
            type: ArtifactType.AWS_CLOUDFORMATION_STACK,
            properties: {
              directoryName: 'dir',
              file: 'file',
              templateFile: 'template',
              assumeRoleAdditionalOptions: {
                ExternalId: 'external-id',
              },
            },
          },
        },
      },
      'somewhere',
    );
  }).toThrow('ExternalId is not allowed inside \'assumeRoleAdditionalOptions\'');
});

test('assumeRoleAdditionalOptions.RoleArn is validated in missing context', () => {
  expect(() => {
    Manifest.saveAssemblyManifest(
      {
        version: 'version',
        missing: [
          {
            key: 'key',
            provider: ContextProvider.AMI_PROVIDER,
            props: {
              account: '123456789012',
              region: 'us-east-1',
              assumeRoleAdditionalOptions: {
                RoleArn: 'role',
              },
            },
          },
        ],
      },
      'somewhere',
    );
  }).toThrow('RoleArn is not allowed inside \'assumeRoleAdditionalOptions\'');
});

test('assumeRoleAdditionalOptions.ExternalId is validated in missing context', () => {
  expect(() => {
    Manifest.saveAssemblyManifest(
      {
        version: 'version',
        missing: [
          {
            key: 'key',
            provider: ContextProvider.AMI_PROVIDER,
            props: {
              account: '123456789012',
              region: 'us-east-1',
              assumeRoleAdditionalOptions: {
                ExternalId: 'external-id',
              },
            },
          },
        ],
      },
      'somewhere',
    );
  }).toThrow('ExternalId is not allowed inside \'assumeRoleAdditionalOptions\'');
});

test('manifest load', () => {
  const loaded = Manifest.loadAssemblyManifest(fixture('only-version'));
  expect(loaded).toMatchSnapshot();
});

test('manifest load fails for invalid nested property', () => {
  expect(() => Manifest.loadAssemblyManifest(fixture('invalid-nested-property'))).toThrow(
    /Invalid assembly manifest/,
  );
});

test('manifest load fails for invalid artifact type', () => {
  expect(() => Manifest.loadAssemblyManifest(fixture('invalid-artifact-type'))).toThrow(
    /Invalid assembly manifest/,
  );
});

test('manifest load fails on higher major version', () => {
  expect(() => Manifest.loadAssemblyManifest(fixture('high-version'))).toThrow(
    /Cloud assembly schema version mismatch/,
  );
});

test('load error includes CLI error if available', () => {
  expect(() => Manifest.loadAssemblyManifest(fixture('high-version-with-cli'))).toThrow(
    /minimumCliVersion/,
  );
});

// once we start introducing minor version bumps that are considered
// non breaking, this test can be removed.
test('manifest load succeeds on higher minor version', () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-tests'));
  const manifestFile = path.join(outdir, 'manifest.json');

  const newVersion = semver.inc(Manifest.version(), 'minor');
  expect(newVersion).toBeTruthy();

  if (newVersion) {
    const assemblyManifest: AssemblyManifest = {
      version: newVersion,
    };

    // can't use saveAssemblyManifest because it will force the correct version
    fs.writeFileSync(manifestFile, JSON.stringify(assemblyManifest));

    expect(() => Manifest.loadAssemblyManifest(manifestFile)).not.toThrow(
      /Cloud assembly schema version mismatch/,
    );
  }
});

test('manifest load succeeds on higher patch version', () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-tests'));
  const manifestFile = path.join(outdir, 'manifest.json');

  const newVersion = semver.inc(Manifest.version(), 'patch');
  expect(newVersion).toBeTruthy();

  if (newVersion) {
    const assemblyManifest: AssemblyManifest = {
      version: newVersion,
    };

    // can't use saveAssemblyManifest because it will force the correct version
    fs.writeFileSync(manifestFile, JSON.stringify(assemblyManifest));

    expect(() => Manifest.loadAssemblyManifest(manifestFile)).not.toThrow(
      /Cloud assembly schema version mismatch/,
    );
  }
});

test('manifest load does not fail if version checking is disabled, and unknown properties are added', () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-tests'));
  const manifestFile = path.join(outdir, 'manifest.json');
  const newVersion = semver.inc(Manifest.version(), 'major');
  expect(newVersion).toBeTruthy();

  const assemblyManifest: AssemblyManifest = {
    version: newVersion!,
    artifacts: {
      SomeArtifact: {
        type: 'aws:cloudformation:stack',
        thisPropertyWillNeverBeInTheManifest: 'i_hope',
      } as any,
      UnknownArtifact: {
        type: 'unknown-artifact-type',
      } as any,
    },
  };

  // can't use saveAssemblyManifest because it will force the correct version
  fs.writeFileSync(manifestFile, JSON.stringify(assemblyManifest));

  Manifest.loadAssemblyManifest(manifestFile, { skipVersionCheck: true, skipEnumCheck: true });
});

test('manifest load fails on invalid version', () => {
  expect(() => Manifest.loadAssemblyManifest(fixture('invalid-version'))).toThrow(
    /Invalid semver string/,
  );
});

test('manifest load succeeds on unknown properties', () => {
  const manifest = Manifest.loadAssemblyManifest(fixture('unknown-property'));
  expect(manifest.version).toEqual('0.0.0');
});

test('stack-tags are deserialized properly', () => {
  const m: AssemblyManifest = Manifest.loadAssemblyManifest(fixture('with-stack-tags'));

  if (m.artifacts?.stack?.metadata?.AwsCdkPlaygroundBatch[0].data) {
    const entry = m.artifacts.stack.metadata.AwsCdkPlaygroundBatch[0]
      .data as StackTagsMetadataEntry;
    expect(entry[0].key).toEqual('hello');
    expect(entry[0].value).toEqual('world');
  }
  expect(m.version).toEqual('0.0.0');
});

test('can access random metadata', () => {
  const loaded = Manifest.loadAssemblyManifest(fixture('random-metadata'));
  const randomArray = loaded.artifacts?.stack.metadata?.AwsCdkPlaygroundBatch[0].data;
  const randomNumber = loaded.artifacts?.stack.metadata?.AwsCdkPlaygroundBatch[1].data;
  const randomMap = loaded.artifacts?.stack.metadata?.AwsCdkPlaygroundBatch[2].data;

  expect(randomArray).toEqual(['42']);
  expect(randomNumber).toEqual(42);
  expect(randomMap).toEqual({
    key: 'value',
  });

  expect(randomMap).toBeTruthy();

  if (randomMap) {
    expect((randomMap as any).key).toEqual('value');
  }
});
