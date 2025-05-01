import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { Export, StackResourceSummary } from '@aws-sdk/client-cloudformation';
import type { SDK } from '../aws-auth';
import type { NestedStackTemplates } from './nested-stack-helpers';
import type { Template } from './stack-helpers';
import type { ResourceMetadata } from '../resource-metadata';
export interface ListStackResources {
    listStackResources(): Promise<StackResourceSummary[]>;
}
export declare class LazyListStackResources implements ListStackResources {
    private readonly sdk;
    private readonly stackName;
    private stackResources;
    constructor(sdk: SDK, stackName: string);
    listStackResources(): Promise<StackResourceSummary[]>;
}
export interface LookupExport {
    lookupExport(name: string): Promise<Export | undefined>;
}
export declare class LookupExportError extends Error {
}
export declare class LazyLookupExport implements LookupExport {
    private readonly sdk;
    private cachedExports;
    constructor(sdk: SDK);
    lookupExport(name: string): Promise<Export | undefined>;
    private listExports;
}
export declare class CfnEvaluationException extends Error {
}
export interface ResourceDefinition {
    readonly LogicalId: string;
    readonly Type: string;
    readonly Properties: {
        [p: string]: any;
    };
}
export interface EvaluateCloudFormationTemplateProps {
    readonly stackArtifact: CloudFormationStackArtifact;
    readonly stackName?: string;
    readonly template?: Template;
    readonly parameters: {
        [parameterName: string]: string;
    };
    readonly account: string;
    readonly region: string;
    readonly partition: string;
    readonly sdk: SDK;
    readonly nestedStacks?: {
        [nestedStackLogicalId: string]: NestedStackTemplates;
    };
}
export declare class EvaluateCloudFormationTemplate {
    readonly stackArtifact: CloudFormationStackArtifact;
    private readonly stackName;
    private readonly template;
    private readonly context;
    private readonly account;
    private readonly region;
    private readonly partition;
    private readonly sdk;
    private readonly nestedStacks;
    private readonly stackResources;
    private readonly lookupExport;
    private cachedUrlSuffix;
    constructor(props: EvaluateCloudFormationTemplateProps);
    createNestedEvaluateCloudFormationTemplate(stackName: string, nestedTemplate: Template, nestedStackParameters: {
        [parameterName: string]: any;
    }): Promise<EvaluateCloudFormationTemplate>;
    establishResourcePhysicalName(logicalId: string, physicalNameInCfnTemplate: any): Promise<string | undefined>;
    findPhysicalNameFor(logicalId: string): Promise<string | undefined>;
    findLogicalIdForPhysicalName(physicalName: string): Promise<string | undefined>;
    findReferencesTo(logicalId: string): Array<ResourceDefinition>;
    evaluateCfnExpression(cfnExpression: any): Promise<any>;
    getResourceProperty(logicalId: string, propertyName: string): any;
    metadataFor(logicalId: string): ResourceMetadata | undefined;
    private references;
    private parseIntrinsic;
    private findRefTarget;
    private findGetAttTarget;
    private findNestedStack;
    private formatResourceAttribute;
    private getServiceOfResource;
    private getResourceTypeArnPartOfResource;
}
