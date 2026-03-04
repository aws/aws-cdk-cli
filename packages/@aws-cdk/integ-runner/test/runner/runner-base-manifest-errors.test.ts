import { LegacyIntegTestSuite } from '../../lib/runner';
import { IntegTest } from '../../lib/runner/integration-tests';
import { ManifestLoadError } from '../../lib/runner/private/integ-manifest';
import { IntegRunner } from '../../lib/runner/runner-base';
import { testDataPath } from '../helpers';

// Create a concrete implementation of IntegRunner for testing
class TestIntegRunner extends IntegRunner {
  public async runIntegTestCase(): Promise<void> {
    // No-op for testing
  }

  // Expose protected method for testing
  public async testLoadManifest(dir?: string) {
    return this.loadManifest(dir);
  }
}

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
    const runner = new TestIntegRunner({
      cdk: mockCdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
      showOutput: true,
      region: 'eu-west-1',
    });

    // WHEN / THEN
    await expect(runner.testLoadManifest(invalidManifestDir)).rejects.toThrow(ManifestLoadError);
  });

  test('loadManifest falls back to legacy mode when manifest does not exist', async () => {
    // GIVEN
    const nonExistentDir = testDataPath('non-existent-dir');
    const runner = new TestIntegRunner({
      cdk: mockCdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
      showOutput: true,
      region: 'eu-west-1',
    });

    // WHEN
    const result = await runner.testLoadManifest(nonExistentDir);

    // THEN
    expect(result instanceof LegacyIntegTestSuite).toBe(true);
  });
});
