import { withAwsEmulator } from './with-aws-emulator';
import { DEFAULT_TEST_TIMEOUT_S, integTest, withSpecificCdkApp } from '../../lib';

integTest('aws-emulator: bootstrap and deploy', withAwsEmulator(withSpecificCdkApp('simple-app', async (fixture) => {
  // The fixture has already bootstrapped the emulator.
  // The ARN proves the stack went to the emulator, whose account is always 000000000000.
  expect(await fixture.cdkDeploy('simple-1')).toContain(`arn:aws:cloudformation:${fixture.aws.region}:000000000000:stack/${fixture.fullStackName('simple-1')}/`);
})), DEFAULT_TEST_TIMEOUT_S * 1000);
