import { integTest, withSpecificFixture } from '../../lib';

describe('uberpackage', () => {
  integTest('works with cloudformation-include', withSpecificFixture('cfn-include-app', async (fixture) => {
    fixture.log('Starting test of cfn-include with monolithic CDK');

    await fixture.cdkSynth();
  }));
});
