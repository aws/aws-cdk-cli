/**
 * @deprecated
 */
export type Obj<T> = { [key: string]: T };

/**
 * @deprecated
 */
export interface StackSelector {
  allTopLevel?: boolean;
  patterns: string[];
}

/**
 * @deprecated
 */
export interface Component {
  name: string;
  version: string;
}

/**
 * @deprecated
 */
export type BootstrapSource = { source: 'legacy' } | { source: 'default' } | { source: 'custom'; templateFile: string };
