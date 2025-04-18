import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'VPC Lookup',
  withDefaultFixture(async (fixture) => {
    fixture.log('Making sure we are clean before starting.');
    await fixture.cdkDestroy('define-vpc', { modEnv: { ENABLE_VPC_TESTING: 'DEFINE' } });

    fixture.log('Setting up: creating a VPC with known tags');
    await fixture.cdkDeploy('define-vpc', { modEnv: { ENABLE_VPC_TESTING: 'DEFINE' } });
    fixture.log('Setup complete!');

    fixture.log('Verifying we can now import that VPC');
    await fixture.cdkDeploy('import-vpc', { modEnv: { ENABLE_VPC_TESTING: 'IMPORT' } });
  }),
);

// testing a construct with a builtin Nodejs Lambda Function.
// In this case we are testing the s3.Bucket construct with the
// autoDeleteObjects prop set to true, which creates a Lambda backed
// CustomResource. Since the compiled Lambda code (e.g. __entrypoint__.js)
// is bundled as part of the CDK package, we want to make sure we don't
// introduce changes to the compiled code that could prevent the Lambda from
// executing. If we do, this test will timeout and fail.
