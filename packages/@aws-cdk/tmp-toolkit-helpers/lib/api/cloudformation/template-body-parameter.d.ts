import { type CloudFormationStackArtifact, type Environment } from '@aws-cdk/cx-api';
import type { AssetManifestBuilder } from '../deployments';
import type { EnvironmentResources } from '../environment';
import { type IoHelper } from '../io/private';
export type TemplateBodyParameter = {
    TemplateBody?: string;
    TemplateURL?: string;
};
/**
 * Prepares the body parameter for +CreateChangeSet+.
 *
 * If the template is small enough to be inlined into the API call, just return
 * it immediately.
 *
 * Otherwise, add it to the asset manifest to get uploaded to the staging
 * bucket and return its coordinates. If there is no staging bucket, an error
 * is thrown.
 *
 * @param stack     the synthesized stack that provides the CloudFormation template
 * @param toolkitInfo information about the toolkit stack
 */
export declare function makeBodyParameter(ioHelper: IoHelper, stack: CloudFormationStackArtifact, resolvedEnvironment: Environment, assetManifest: AssetManifestBuilder, resources: EnvironmentResources, overrideTemplate?: any): Promise<TemplateBodyParameter>;
