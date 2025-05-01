import * as cxapi from '@aws-cdk/cx-api';
import type { AssetManifestBuilder } from './asset-manifest-builder';
import type { EnvironmentResources } from '../environment';
import { type IoHelper } from '../io/private';
/**
 * Take the metadata assets from the given stack and add them to the given asset manifest
 *
 * Returns the CloudFormation parameters that need to be sent to the template to
 * pass Asset coordinates.
 */
export declare function addMetadataAssetsToManifest(ioHelper: IoHelper, stack: cxapi.CloudFormationStackArtifact, assetManifest: AssetManifestBuilder, envResources: EnvironmentResources, reuse?: string[]): Promise<Record<string, string>>;
