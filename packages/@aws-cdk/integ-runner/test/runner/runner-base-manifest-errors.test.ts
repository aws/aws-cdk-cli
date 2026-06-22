import { CdkIntegHelper, LegacyIntegTestSuite } from '../../lib/runner';
import { IntegTest } from '../../lib/runner/integration-tests';
import { ManifestLoadError } from '../../lib/runner/private/integ-manifest';
import { testDataPath } from '../helpers';

describe('IntegRunner manifest error handling', () => {
  let mockCdk: any;

  beforeEach(() => {
    mockCdk = {
      synthesize: jest.fn(),
      deploy: jest.fn(),
      destroy: jest.fn(),
    };

    // fakeTest = new IntegTest({
    //   fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
    //   discoveryRoot: 'test/test-data',
    // });

    // {
    //   fileName: 'test/integ.test.js',
    //   testName: 'test',
    //   normalizedTestName: 'test',
    //   snapshotDir: 'test.snapshot',
    //   temporaryOutputDir: 'test.output',
    //   appCommand: 'node {filePath}',
    //   discoveryRelativeFileName: 1,
    //   absoluteFileName: 1,
    //   directory: 'test',
    //   info: 1,
    //   matches: '',
    // };
  });

  test('loadManifest throws ManifestLoadError when manifest is invalid', async () => {
    // GIVEN
    const invalidManifestDir = testDataPath('invalid-integ-manifest');
    const runner = CdkIntegHelper.create({
      cdk: mockCdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
      showOutput: true,
      region: 'eu-west-1',
    });

    // WHEN / THEN
    await expect(runner.loadManifest(invalidManifestDir)).rejects.toThrow(ManifestLoadError);
  });

  test('loadManifest falls back to legacy mode when manifest does not exist', async () => {
    // GIVEN
    const nonExistentDir = testDataPath('non-existent-dir');
    const runner = CdkIntegHelper.create({
      cdk: mockCdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
      showOutput: true,
      region: 'eu-west-1',
    });

    // WHEN
    const result = await runner.loadManifest(nonExistentDir);

    // THEN
    expect(result instanceof LegacyIntegTestSuite).toBe(true);
  });
});
