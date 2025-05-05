import type { Environment } from '@aws-cdk/cx-api';

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
   * A set of affected components
   *
   * The canonical form of a list of components is in Disjunctive Normal Form
   * (i.e., an OR of ANDs). This is the form when the list of components is a
   * doubly nested array: the notice matches if all components of at least one
   * of the top-level array matches.
   *
   * If the `components` is a single-level array, it is evaluated as an OR; it
   * matches if any of the components matches.
   */
  components: Array<Component | Component[]>;
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
