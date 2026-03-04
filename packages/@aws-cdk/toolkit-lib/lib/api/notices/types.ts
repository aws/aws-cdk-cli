import type { Environment } from '@aws-cdk/cloud-assembly-api';

export interface Component {
  name: string;

  /**
   * The range of affected versions
   */
  version: string;
}

export interface Notice {
  title: string;
  issueNumber: number;
  overview: string;
  /**
   * A flat list of affected components, evaluated as an OR.
   *
   * The notice matches if any single component matches.
   */
  components: Array<Component>;
  /**
   * A list of affected components in Disjunctive Normal Form (OR of ANDs).
   *
   * The outer array is an OR, the inner arrays are ANDs. The notice matches
   * if all components of at least one inner array match.
   *
   * Only available when `schemaVersion` is `'2'`.
   */
  componentsV2?: Array<Component | Component[]>;
  schemaVersion: string;
  severity?: string;
}

export interface NoticeDataSource {
  fetch(): Promise<Notice[]>;
}

/**
 * Information about a bootstrapped environment.
 */
export interface BootstrappedEnvironment {
  readonly bootstrapStackVersion: number;
  readonly environment: Environment;
}
