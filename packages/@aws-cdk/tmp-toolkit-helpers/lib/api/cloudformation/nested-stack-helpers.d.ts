import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { SDK } from '../aws-auth';
import { type Template } from './stack-helpers';
export interface RootTemplateWithNestedStacks {
    readonly deployedRootTemplate: Template;
    readonly nestedStacks: {
        [nestedStackLogicalId: string]: NestedStackTemplates;
    };
}
/**
 * Reads the currently deployed template and all of its nested stack templates from CloudFormation.
 */
export declare function loadCurrentTemplateWithNestedStacks(rootStackArtifact: CloudFormationStackArtifact, sdk: SDK, retrieveProcessedTemplate?: boolean): Promise<RootTemplateWithNestedStacks>;
/**
 * Returns the currently deployed template from CloudFormation that corresponds to `stackArtifact`.
 */
export declare function loadCurrentTemplate(stackArtifact: CloudFormationStackArtifact, sdk: SDK, retrieveProcessedTemplate?: boolean): Promise<Template>;
export interface NestedStackTemplates {
    readonly physicalName: string | undefined;
    readonly deployedTemplate: Template;
    readonly generatedTemplate: Template;
    readonly nestedStackTemplates: {
        [nestedStackLogicalId: string]: NestedStackTemplates;
    };
}
