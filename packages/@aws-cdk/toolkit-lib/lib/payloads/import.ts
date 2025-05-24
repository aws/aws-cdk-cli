import type { DataRequest } from './types';

/**
 * A proposed resource import.
 */
export interface ResourceImportRequest {
  /**
   * The resource to be imported
   */
  readonly resource: {
    /**
     * The CloudFormation resource type of the resource
     */
    readonly type: string;
    /**
     * The properties of the imported resource
     */
    readonly props: Record<string, any>;
    /**
     * A formattated string representation of the props.
     */
    readonly stringifiedProps: string;
  };
}

/**
 * A resource that needs to be identified during an import.
 */
export interface ResourceIdentificationRequest extends DataRequest {
  /**
   * The resource that needs to be identified.
   */
  readonly resource: {
    /**
     * The construct path or logical id of the resource.
     */
    readonly name: string;
    /**
     * The type of the resource.
     */
    readonly type: string;
    /**
     * The property that we try to identify the resource by.
     */
    readonly idProp: string;
  };
}
