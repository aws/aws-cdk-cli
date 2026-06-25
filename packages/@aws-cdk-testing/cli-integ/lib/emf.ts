/**
 * Emit an EMF event with the versions of the CLI, library, toolkit-lib and cdk-assets that were used to run the tests.
 *
 * The version numbers are first scalarized so that they can be graphed, and the CodeBuild Project Name is used as
 * a dimension to keep different test runs in the same account separate.
 *
 * The way EMF works, if CloudWatch sees a log message like this it will
 * automatically emit metric data from these fields.
 */
export function emitVersionsEmf(versions: Versions) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(createVersionsEmf(versions)));
}

export function createVersionsEmf(versions: Versions) {
  const emf = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: 'CDK/CLIInteg',
        Dimensions: [['ProjectName']],
        Metrics: [
          { Name: 'CliVersion' },
          { Name: 'LibraryVersion' },
          { Name: 'ToolkitLibVersion' },
          { Name: 'CdkAssetsVersion' },
          { Name: 'TestsVersion' },
        ],
      }],
    },
    // Dimensions
    ProjectName: process.env.CODEBUILD_BUILD_ID?.split(':')[0] ?? 'unknown',
    // Metrics
    CliVersion: scalarizeVersion(versions.cli),
    LibraryVersion: scalarizeVersion(versions.library),
    ToolkitLibVersion: scalarizeVersion(versions.toolkitLib),
    CdkAssetsVersion: scalarizeVersion(versions.cdkAssets),
    TestsVersion: scalarizeVersion(versions.tests),
  };

  return emf;

  function scalarizeVersion(version: string): number {
    const parts = version.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!parts) {
      return 0;
    }

    const vs = parts.slice(1).map(p => parseInt(p, 10));

    // This gives 4 digits for the minor version (necessary for the CLI), and 1 digit for the patch version
    return vs[0] * 100000
      + (vs[1] % 10000) * 10
      + vs[2] % 10;
  }
}

export interface Versions {
  readonly cli: string;
  readonly library: string;
  readonly toolkitLib: string;
  readonly cdkAssets: string;
  readonly tests: string;
}
