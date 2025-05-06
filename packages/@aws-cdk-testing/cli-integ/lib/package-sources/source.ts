/**
 * The part of a source that executes in the runner
 *
 * `SourceType` should be either `ITestLibrarySource` or `ITestCliSource`,
 * and will be loaded in the test process.
 */
export interface IRunnerSource<SourceType> {
  readonly sourceDescription: string;

  runnerPrepare(): Promise<IPreparedRunnerSource<SourceType>>;
}

export interface IPreparedRunnerSource<SourceType> {
  readonly version: string;

  dispose(): Promise<void>;

  /**
   * Return the constructor and constructor arguments for the actual source
   * class in the test process.
   */
  serialize(): SourceDescriptor<SourceType>;
}

export type Constructor<A> = new (...args: any[]) => A;

export type SourceDescriptor<A> = [Constructor<A>, any[]]

export interface ITestCliSource {
  /**
   * Adds the CLI to the $PATH
   */
  makeCliAvailable(): Promise<void>;

  /**
   * The CLI version
   */
  requestedVersion(): string;
}

export interface ITestLibrarySource {
  /**
   * Requested library version
   */
  requestedVersion(): string;

  /**
   * Versions of alpha packages
   */
  requestedAlphaVersion(): string;

  assertJsiiPackagesAvailable(): void;

  /**
   * Put the right files into the given directory to make .NET use the CodeArtifact repos (if configured)
   */
  initializeDotnetPackages(targetDir: string): Promise<void>;
}
