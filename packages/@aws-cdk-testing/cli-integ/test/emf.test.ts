import { createVersionsEmf } from '../lib/emf';

process.env.CODEBUILD_BUILD_ID = 'test-project:1234567890';

// Do not be weirded out by _ inside the numbers. They have no semantic meaning.
// You would usually use them as 1000s separators, but here I'm using them to make the version components
// easier to see.

test('EMF conversion', () => {
  const emf = createVersionsEmf({
    cli: '2.1128.1 (npm)',
    library: 'aws-cdk-lib@2.260.0',
    toolkitLib: '@aws-cdk/toolkit-lib@latest',
    cdkAssets: 'latest (npm)',
    tests: '3.33.2',
  });

  expect(emf).toEqual(expect.objectContaining({
    CliVersion: 2_1128_1,
    LibraryVersion: 2_0260_0,
    ToolkitLibVersion: 0,
    CdkAssetsVersion: 0,
    TestsVersion: 3_0033_2,
    ProjectName: 'test-project',
  }));
});

test('overflow doesnt spill over into next version component', () => {
  const emf = createVersionsEmf({
    cli: '2.1128.1-rc.99',
    library: 'aws-cdk-lib@2.260.666',
    toolkitLib: '1.123123.1',
    cdkAssets: 'v2',
    tests: 'v3',
  });

  expect(emf).toEqual(expect.objectContaining({
    // RC is ignored
    CliVersion: 2_1128_1,

    // .666 is modulo'ed to .6
    LibraryVersion: 2_0260_6,

    // .123123. is modulo'ed to 3123
    ToolkitLibVersion: 1_3123_1,
  }));
});
