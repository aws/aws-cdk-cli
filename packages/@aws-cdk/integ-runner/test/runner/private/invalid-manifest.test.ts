import { IntegTestSuite } from '../../../lib/runner/integ-test-suite';
import { IntegManifestReader, ManifestLoadError } from '../../../lib/runner/private/integ-manifest';
import { testDataPath } from '../../helpers';

describe('Invalid Manifest Handling', () => {
  test('throws ManifestLoadError when loading an invalid JSON manifest', () => {
    // GIVEN
    const invalidManifestPath = testDataPath('invalid-integ-manifest', 'integ.json');

    // WHEN / THEN
    expect(() => IntegManifestReader.fromFile(invalidManifestPath)).toThrow(ManifestLoadError);
  });

  test('IntegTestSuite.fromPath propagates ManifestLoadError', () => {
    // GIVEN
    const invalidManifestDir = testDataPath('invalid-integ-manifest');

    // WHEN / THEN
    expect(() => IntegTestSuite.fromPath(invalidManifestDir)).toThrow(ManifestLoadError);
  });
});
