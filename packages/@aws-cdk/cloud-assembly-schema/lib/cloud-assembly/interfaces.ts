// The interfaces in this file, mainly exist __here__ because this is a convenient place to put them.
// The Assembly Schema package is already a jsii package and a dependency of `aws-cdk-lib`.
// It is effectively the only place we can put shared interfaces to be used across the jsii ecosystem.
//
// Putting a shared interface in here should be a huge exception.
// It needs to be justified by great benefits it provides to the ecosystems.
// All interfaces should be as minimal as possible.

/**
 * Interoperable representation of a deployable cloud application.
 *
 * The external and interoperable contract for a Cloud Assembly is
 * a directory containing a valid Cloud Assembly.
 *
 * Implementations should use the directory to load the Cloud Assembly from disk.
 * It is recommended that implementations validate loaded manifest files using
 * the provided functionality from this package.
 * Within an implementation, it may be prudent to keep (parts of) the Cloud Assembly
 * in memory during execution and use an implementation-specific contract.
 * However when an implementation is providing an external contract,
 * this interface should be used.
 */
export interface ICloudAssembly {
  /**
   * The directory of the cloud assembly.
   *
   * This directory will be used to read the Cloud Assembly from.
   * Its contents (in particular `manifest.json`) must comply with the schema defined in this package.
   */
  readonly directory: string;
}
