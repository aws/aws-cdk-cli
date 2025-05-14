import { integTest, withSpecificFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff --import-existing-resources show resource being imported',
  withSpecificFixture('import-app', async (fixture) => {
    // GIVEN
    await fixture.cdkDeploy('base-1', {
      modEnv: {
        VERSION: 'v1',
      },
    });

    // THEN
    let diff = await fixture.cdk(['diff --import-existing-resources', fixture.fullStackName('base-1')], {
      modEnv: {
        VERSION: 'v2',
      },
    });

    console.log('first diff' + diff);
    // Assert there are no changes and diff shows import
    expect(diff).not.toContain('There were no differences');
    expect(diff).toContain('[←]');
    expect(diff).toContain('import');

    // THEN
    diff = await fixture.cdk(['diff', fixture.fullStackName('base-1')], {
      modEnv: {
        VERSION: 'v2',
      },
    });

    console.log('second diff' + diff);
    // Assert there are no changes and diff shows add
    expect(diff).not.toContain('There were no differences');
    expect(diff).toContain('[+]');

    // Deploy the stack with v3 to set table removal policy as destroy
    await fixture.cdkDeploy('base-1', {
      modEnv: {
        VERSION: 'v3',
      },
    });
  }),
);
