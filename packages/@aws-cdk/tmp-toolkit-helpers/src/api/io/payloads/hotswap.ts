import type * as cxapi from '@aws-cdk/cx-api';

export interface HotswapDeployment {
  readonly stack: cxapi.CloudFormationStackArtifact;
}

export interface HotswapChange {
  readonly displayName: string;
}
