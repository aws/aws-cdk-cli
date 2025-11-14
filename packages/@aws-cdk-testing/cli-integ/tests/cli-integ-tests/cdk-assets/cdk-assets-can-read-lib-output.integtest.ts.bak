import * as path from 'path';
import { integTest } from '../../../lib/integ-test';
import { withDefaultFixture } from '../../../lib/with-cdk-app';

integTest('cdk-assets can read lib output', withDefaultFixture(async (fixture) => {
  await fixture.cdkSynth();

  await fixture.cdkAssets.makeCliAvailable();

  const assetManifestFile = path.join(fixture.integTestDir, 'cdk.out', `${fixture.fullStackName('test-1')}.assets.json`);

  // Should not fail
  await fixture.shell(['cdk-assets', '--path', assetManifestFile, 'ls']);
}));
