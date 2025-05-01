"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvaluateCloudFormationTemplate = exports.CfnEvaluationException = exports.LazyLookupExport = exports.LookupExportError = exports.LazyListStackResources = void 0;
const toolkit_error_1 = require("../toolkit-error");
const resource_metadata_1 = require("../resource-metadata");
class LazyListStackResources {
    sdk;
    stackName;
    stackResources;
    constructor(sdk, stackName) {
        this.sdk = sdk;
        this.stackName = stackName;
    }
    async listStackResources() {
        if (this.stackResources === undefined) {
            this.stackResources = this.sdk.cloudFormation().listStackResources({
                StackName: this.stackName,
            });
        }
        return this.stackResources;
    }
}
exports.LazyListStackResources = LazyListStackResources;
class LookupExportError extends Error {
}
exports.LookupExportError = LookupExportError;
class LazyLookupExport {
    sdk;
    cachedExports = {};
    constructor(sdk) {
        this.sdk = sdk;
    }
    async lookupExport(name) {
        if (this.cachedExports[name]) {
            return this.cachedExports[name];
        }
        for await (const cfnExport of this.listExports()) {
            if (!cfnExport.Name) {
                continue; // ignore any result that omits a name
            }
            this.cachedExports[cfnExport.Name] = cfnExport;
            if (cfnExport.Name === name) {
                return cfnExport;
            }
        }
        return undefined; // export not found
    }
    // TODO: Paginate
    async *listExports() {
        let nextToken = undefined;
        while (true) {
            const response = await this.sdk.cloudFormation().listExports({ NextToken: nextToken });
            for (const cfnExport of response.Exports ?? []) {
                yield cfnExport;
            }
            if (!response.NextToken) {
                return;
            }
            nextToken = response.NextToken;
        }
    }
}
exports.LazyLookupExport = LazyLookupExport;
class CfnEvaluationException extends Error {
}
exports.CfnEvaluationException = CfnEvaluationException;
class EvaluateCloudFormationTemplate {
    stackArtifact;
    stackName;
    template;
    context;
    account;
    region;
    partition;
    sdk;
    nestedStacks;
    stackResources;
    lookupExport;
    cachedUrlSuffix;
    constructor(props) {
        this.stackArtifact = props.stackArtifact;
        this.stackName = props.stackName ?? props.stackArtifact.stackName;
        this.template = props.template ?? props.stackArtifact.template;
        this.context = {
            'AWS::AccountId': props.account,
            'AWS::Region': props.region,
            'AWS::Partition': props.partition,
            ...props.parameters,
        };
        this.account = props.account;
        this.region = props.region;
        this.partition = props.partition;
        this.sdk = props.sdk;
        // We need names of nested stack so we can evaluate cross stack references
        this.nestedStacks = props.nestedStacks ?? {};
        // The current resources of the Stack.
        // We need them to figure out the physical name of a resource in case it wasn't specified by the user.
        // We fetch it lazily, to save a service call, in case all hotswapped resources have their physical names set.
        this.stackResources = new LazyListStackResources(this.sdk, this.stackName);
        // CloudFormation Exports lookup to be able to resolve Fn::ImportValue intrinsics in template
        this.lookupExport = new LazyLookupExport(this.sdk);
    }
    // clones current EvaluateCloudFormationTemplate object, but updates the stack name
    async createNestedEvaluateCloudFormationTemplate(stackName, nestedTemplate, nestedStackParameters) {
        const evaluatedParams = await this.evaluateCfnExpression(nestedStackParameters);
        return new EvaluateCloudFormationTemplate({
            stackArtifact: this.stackArtifact,
            stackName,
            template: nestedTemplate,
            parameters: evaluatedParams,
            account: this.account,
            region: this.region,
            partition: this.partition,
            sdk: this.sdk,
            nestedStacks: this.nestedStacks,
        });
    }
    async establishResourcePhysicalName(logicalId, physicalNameInCfnTemplate) {
        if (physicalNameInCfnTemplate != null) {
            try {
                return await this.evaluateCfnExpression(physicalNameInCfnTemplate);
            }
            catch (e) {
                // If we can't evaluate the resource's name CloudFormation expression,
                // just look it up in the currently deployed Stack
                if (!(e instanceof CfnEvaluationException)) {
                    throw e;
                }
            }
        }
        return this.findPhysicalNameFor(logicalId);
    }
    async findPhysicalNameFor(logicalId) {
        const stackResources = await this.stackResources.listStackResources();
        return stackResources.find((sr) => sr.LogicalResourceId === logicalId)?.PhysicalResourceId;
    }
    async findLogicalIdForPhysicalName(physicalName) {
        const stackResources = await this.stackResources.listStackResources();
        return stackResources.find((sr) => sr.PhysicalResourceId === physicalName)?.LogicalResourceId;
    }
    findReferencesTo(logicalId) {
        const ret = new Array();
        for (const [resourceLogicalId, resourceDef] of Object.entries(this.template?.Resources ?? {})) {
            if (logicalId !== resourceLogicalId && this.references(logicalId, resourceDef)) {
                ret.push({
                    ...resourceDef,
                    LogicalId: resourceLogicalId,
                });
            }
        }
        return ret;
    }
    async evaluateCfnExpression(cfnExpression) {
        const self = this;
        /**
         * Evaluates CloudFormation intrinsic functions
         *
         * Note that supported intrinsic functions are documented in README.md -- please update
         * list of supported functions when adding new evaluations
         *
         * See: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html
         */
        class CfnIntrinsics {
            evaluateIntrinsic(intrinsic) {
                const intrinsicFunc = this[intrinsic.name];
                if (!intrinsicFunc) {
                    throw new CfnEvaluationException(`CloudFormation function ${intrinsic.name} is not supported`);
                }
                const argsAsArray = Array.isArray(intrinsic.args) ? intrinsic.args : [intrinsic.args];
                return intrinsicFunc.apply(this, argsAsArray);
            }
            async 'Fn::Join'(separator, args) {
                const evaluatedArgs = await self.evaluateCfnExpression(args);
                return evaluatedArgs.join(separator);
            }
            async 'Fn::Split'(separator, args) {
                const evaluatedArgs = await self.evaluateCfnExpression(args);
                return evaluatedArgs.split(separator);
            }
            async 'Fn::Select'(index, args) {
                const evaluatedArgs = await self.evaluateCfnExpression(args);
                return evaluatedArgs[index];
            }
            async Ref(logicalId) {
                const refTarget = await self.findRefTarget(logicalId);
                if (refTarget) {
                    return refTarget;
                }
                else {
                    throw new CfnEvaluationException(`Parameter or resource '${logicalId}' could not be found for evaluation`);
                }
            }
            async 'Fn::GetAtt'(logicalId, attributeName) {
                // ToDo handle the 'logicalId.attributeName' form of Fn::GetAtt
                const attrValue = await self.findGetAttTarget(logicalId, attributeName);
                if (attrValue) {
                    return attrValue;
                }
                else {
                    throw new CfnEvaluationException(`Attribute '${attributeName}' of resource '${logicalId}' could not be found for evaluation`);
                }
            }
            async 'Fn::Sub'(template, explicitPlaceholders) {
                const placeholders = explicitPlaceholders ? await self.evaluateCfnExpression(explicitPlaceholders) : {};
                return asyncGlobalReplace(template, /\${([^}]*)}/g, (key) => {
                    if (key in placeholders) {
                        return placeholders[key];
                    }
                    else {
                        const splitKey = key.split('.');
                        return splitKey.length === 1 ? this.Ref(key) : this['Fn::GetAtt'](splitKey[0], splitKey.slice(1).join('.'));
                    }
                });
            }
            async 'Fn::ImportValue'(name) {
                const exported = await self.lookupExport.lookupExport(name);
                if (!exported) {
                    throw new CfnEvaluationException(`Export '${name}' could not be found for evaluation`);
                }
                if (!exported.Value) {
                    throw new CfnEvaluationException(`Export '${name}' exists without a value`);
                }
                return exported.Value;
            }
        }
        if (cfnExpression == null) {
            return cfnExpression;
        }
        if (Array.isArray(cfnExpression)) {
            // Small arrays in practice
            // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
            return Promise.all(cfnExpression.map((expr) => this.evaluateCfnExpression(expr)));
        }
        if (typeof cfnExpression === 'object') {
            const intrinsic = this.parseIntrinsic(cfnExpression);
            if (intrinsic) {
                return new CfnIntrinsics().evaluateIntrinsic(intrinsic);
            }
            else {
                const ret = {};
                for (const [key, val] of Object.entries(cfnExpression)) {
                    ret[key] = await this.evaluateCfnExpression(val);
                }
                return ret;
            }
        }
        return cfnExpression;
    }
    getResourceProperty(logicalId, propertyName) {
        return this.template.Resources?.[logicalId]?.Properties?.[propertyName];
    }
    metadataFor(logicalId) {
        return (0, resource_metadata_1.resourceMetadata)(this.stackArtifact, logicalId);
    }
    references(logicalId, templateElement) {
        if (typeof templateElement === 'string') {
            return logicalId === templateElement;
        }
        if (templateElement == null) {
            return false;
        }
        if (Array.isArray(templateElement)) {
            return templateElement.some((el) => this.references(logicalId, el));
        }
        if (typeof templateElement === 'object') {
            return Object.values(templateElement).some((el) => this.references(logicalId, el));
        }
        return false;
    }
    parseIntrinsic(x) {
        const keys = Object.keys(x);
        if (keys.length === 1 && (keys[0].startsWith('Fn::') || keys[0] === 'Ref')) {
            return {
                name: keys[0],
                args: x[keys[0]],
            };
        }
        return undefined;
    }
    async findRefTarget(logicalId) {
        // first, check to see if the Ref is a Parameter who's value we have
        if (logicalId === 'AWS::URLSuffix') {
            if (!this.cachedUrlSuffix) {
                this.cachedUrlSuffix = await this.sdk.getUrlSuffix(this.region);
            }
            return this.cachedUrlSuffix;
        }
        // Try finding the ref in the passed in parameters
        const parameterTarget = this.context[logicalId];
        if (parameterTarget) {
            return parameterTarget;
        }
        // If not in the passed in parameters, see if there is a default value in the template parameter that was not passed in
        const defaultParameterValue = this.template.Parameters?.[logicalId]?.Default;
        if (defaultParameterValue) {
            return defaultParameterValue;
        }
        // if it's not a Parameter, we need to search in the current Stack resources
        return this.findGetAttTarget(logicalId);
    }
    async findGetAttTarget(logicalId, attribute) {
        // Handle case where the attribute is referencing a stack output (used in nested stacks to share parameters)
        // See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/quickref-cloudformation.html#w2ab1c17c23c19b5
        if (logicalId === 'Outputs' && attribute) {
            return this.evaluateCfnExpression(this.template.Outputs[attribute]?.Value);
        }
        const stackResources = await this.stackResources.listStackResources();
        const foundResource = stackResources.find((sr) => sr.LogicalResourceId === logicalId);
        if (!foundResource) {
            return undefined;
        }
        if (foundResource.ResourceType == 'AWS::CloudFormation::Stack' && attribute?.startsWith('Outputs.')) {
            const dependantStack = this.findNestedStack(logicalId, this.nestedStacks);
            if (!dependantStack || !dependantStack.physicalName) {
                // this is a newly created nested stack and cannot be hotswapped
                return undefined;
            }
            const evaluateCfnTemplate = await this.createNestedEvaluateCloudFormationTemplate(dependantStack.physicalName, dependantStack.generatedTemplate, dependantStack.generatedTemplate.Parameters);
            // Split Outputs.<refName> into 'Outputs' and '<refName>' and recursively call evaluate
            return evaluateCfnTemplate.evaluateCfnExpression({
                'Fn::GetAtt': attribute.split(/\.(.*)/s),
            });
        }
        // now, we need to format the appropriate identifier depending on the resource type,
        // and the requested attribute name
        return this.formatResourceAttribute(foundResource, attribute);
    }
    findNestedStack(logicalId, nestedStacks) {
        for (const nestedStackLogicalId of Object.keys(nestedStacks)) {
            if (nestedStackLogicalId === logicalId) {
                return nestedStacks[nestedStackLogicalId];
            }
            const checkInNestedChildStacks = this.findNestedStack(logicalId, nestedStacks[nestedStackLogicalId].nestedStackTemplates);
            if (checkInNestedChildStacks)
                return checkInNestedChildStacks;
        }
        return undefined;
    }
    formatResourceAttribute(resource, attribute) {
        const physicalId = resource.PhysicalResourceId;
        // no attribute means Ref expression, for which we use the physical ID directly
        if (!attribute) {
            return physicalId;
        }
        const resourceTypeFormats = RESOURCE_TYPE_ATTRIBUTES_FORMATS[resource.ResourceType];
        if (!resourceTypeFormats) {
            throw new CfnEvaluationException(`We don't support attributes of the '${resource.ResourceType}' resource. This is a CDK limitation. ` +
                'Please report it at https://github.com/aws/aws-cdk/issues/new/choose');
        }
        const attributeFmtFunc = resourceTypeFormats[attribute];
        if (!attributeFmtFunc) {
            throw new CfnEvaluationException(`We don't support the '${attribute}' attribute of the '${resource.ResourceType}' resource. This is a CDK limitation. ` +
                'Please report it at https://github.com/aws/aws-cdk/issues/new/choose');
        }
        const service = this.getServiceOfResource(resource);
        const resourceTypeArnPart = this.getResourceTypeArnPartOfResource(resource);
        return attributeFmtFunc({
            partition: this.partition,
            service,
            region: this.region,
            account: this.account,
            resourceType: resourceTypeArnPart,
            resourceName: physicalId,
        });
    }
    getServiceOfResource(resource) {
        return resource.ResourceType.split('::')[1].toLowerCase();
    }
    getResourceTypeArnPartOfResource(resource) {
        const resourceType = resource.ResourceType;
        const specialCaseResourceType = RESOURCE_TYPE_SPECIAL_NAMES[resourceType]?.resourceType;
        return specialCaseResourceType
            ? specialCaseResourceType
            : // this is the default case
                resourceType.split('::')[2].toLowerCase();
    }
}
exports.EvaluateCloudFormationTemplate = EvaluateCloudFormationTemplate;
/**
 * Usually, we deduce the names of the service and the resource type used to format the ARN from the CloudFormation resource type.
 * For a CFN type like AWS::Service::ResourceType, the second segment becomes the service name, and the third the resource type
 * (after converting both of them to lowercase).
 * However, some resource types break this simple convention, and we need to special-case them.
 * This map is for storing those cases.
 */
const RESOURCE_TYPE_SPECIAL_NAMES = {
    'AWS::Events::EventBus': {
        resourceType: 'event-bus',
    },
};
const RESOURCE_TYPE_ATTRIBUTES_FORMATS = {
    'AWS::IAM::Role': { Arn: iamArnFmt },
    'AWS::IAM::User': { Arn: iamArnFmt },
    'AWS::IAM::Group': { Arn: iamArnFmt },
    'AWS::S3::Bucket': { Arn: s3ArnFmt },
    'AWS::Lambda::Function': { Arn: stdColonResourceArnFmt },
    'AWS::Events::EventBus': {
        Arn: stdSlashResourceArnFmt,
        // the name attribute of the EventBus is the same as the Ref
        Name: (parts) => parts.resourceName,
    },
    'AWS::DynamoDB::Table': { Arn: stdSlashResourceArnFmt },
    'AWS::AppSync::GraphQLApi': { ApiId: appsyncGraphQlApiApiIdFmt },
    'AWS::AppSync::FunctionConfiguration': {
        FunctionId: appsyncGraphQlFunctionIDFmt,
    },
    'AWS::AppSync::DataSource': { Name: appsyncGraphQlDataSourceNameFmt },
    'AWS::KMS::Key': { Arn: stdSlashResourceArnFmt },
};
function iamArnFmt(parts) {
    // we skip region for IAM resources
    return `arn:${parts.partition}:${parts.service}::${parts.account}:${parts.resourceType}/${parts.resourceName}`;
}
function s3ArnFmt(parts) {
    // we skip account, region and resourceType for S3 resources
    return `arn:${parts.partition}:${parts.service}:::${parts.resourceName}`;
}
function stdColonResourceArnFmt(parts) {
    // this is a standard format for ARNs like: arn:aws:service:region:account:resourceType:resourceName
    return `arn:${parts.partition}:${parts.service}:${parts.region}:${parts.account}:${parts.resourceType}:${parts.resourceName}`;
}
function stdSlashResourceArnFmt(parts) {
    // this is a standard format for ARNs like: arn:aws:service:region:account:resourceType/resourceName
    return `arn:${parts.partition}:${parts.service}:${parts.region}:${parts.account}:${parts.resourceType}/${parts.resourceName}`;
}
function appsyncGraphQlApiApiIdFmt(parts) {
    // arn:aws:appsync:us-east-1:111111111111:apis/<apiId>
    return parts.resourceName.split('/')[1];
}
function appsyncGraphQlFunctionIDFmt(parts) {
    // arn:aws:appsync:us-east-1:111111111111:apis/<apiId>/functions/<functionId>
    return parts.resourceName.split('/')[3];
}
function appsyncGraphQlDataSourceNameFmt(parts) {
    // arn:aws:appsync:us-east-1:111111111111:apis/<apiId>/datasources/<name>
    return parts.resourceName.split('/')[3];
}
async function asyncGlobalReplace(str, regex, cb) {
    if (!regex.global) {
        throw new toolkit_error_1.ToolkitError('Regex must be created with /g flag');
    }
    const ret = new Array();
    let start = 0;
    while (true) {
        const match = regex.exec(str);
        if (!match) {
            break;
        }
        ret.push(str.substring(start, match.index));
        ret.push(await cb(match[1]));
        start = regex.lastIndex;
    }
    ret.push(str.slice(start));
    return ret.join('');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXZhbHVhdGUtY2xvdWRmb3JtYXRpb24tdGVtcGxhdGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2Nsb3VkZm9ybWF0aW9uL2V2YWx1YXRlLWNsb3VkZm9ybWF0aW9uLXRlbXBsYXRlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUdBLG9EQUFnRDtBQUloRCw0REFBd0Q7QUFNeEQsTUFBYSxzQkFBc0I7SUFJZDtJQUNBO0lBSlgsY0FBYyxDQUE4QztJQUVwRSxZQUNtQixHQUFRLEVBQ1IsU0FBaUI7UUFEakIsUUFBRyxHQUFILEdBQUcsQ0FBSztRQUNSLGNBQVMsR0FBVCxTQUFTLENBQVE7SUFFcEMsQ0FBQztJQUVNLEtBQUssQ0FBQyxrQkFBa0I7UUFDN0IsSUFBSSxJQUFJLENBQUMsY0FBYyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3RDLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQztnQkFDakUsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO2FBQzFCLENBQUMsQ0FBQztRQUNMLENBQUM7UUFDRCxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUM7SUFDN0IsQ0FBQztDQUNGO0FBakJELHdEQWlCQztBQU1ELE1BQWEsaUJBQWtCLFNBQVEsS0FBSztDQUMzQztBQURELDhDQUNDO0FBRUQsTUFBYSxnQkFBZ0I7SUFHRTtJQUZyQixhQUFhLEdBQStCLEVBQUUsQ0FBQztJQUV2RCxZQUE2QixHQUFRO1FBQVIsUUFBRyxHQUFILEdBQUcsQ0FBSztJQUNyQyxDQUFDO0lBRUQsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFZO1FBQzdCLElBQUksSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQzdCLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNsQyxDQUFDO1FBRUQsSUFBSSxLQUFLLEVB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Q0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBRTNCLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUN0QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBDbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QgfSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0IHR5cGUgeyBFeHBvcnQsIExpc3RFeHBvcnRzQ29tbWFuZE91dHB1dCwgU3RhY2tSZXNvdXJjZVN1bW1hcnkgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtY2xvdWRmb3JtYXRpb24nO1xuaW1wb3J0IHR5cGUgeyBTREsgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcbmltcG9ydCB0eXBlIHsgTmVzdGVkU3RhY2tUZW1wbGF0ZXMgfSBmcm9tICcuL25lc3RlZC1zdGFjay1oZWxwZXJzJztcbmltcG9ydCB0eXBlIHsgVGVtcGxhdGUgfSBmcm9tICcuL3N0YWNrLWhlbHBlcnMnO1xuaW1wb3J0IHR5cGUgeyBSZXNvdXJjZU1ldGFkYXRhIH0gZnJvbSAnLi4vcmVzb3VyY2UtbWV0YWRhdGEnO1xuaW1wb3J0IHsgcmVzb3VyY2VNZXRhZGF0YSB9IGZyb20gJy4uL3Jlc291cmNlLW1ldGFkYXRhJztcblxuZXhwb3J0IGludGVyZmFjZSBMaXN0U3RhY2tSZXNvdXJjZXMge1xuICBsaXN0U3RhY2tSZXNvdXJjZXMoKTogUHJvbWlzZTxTdGFja1Jlc291cmNlU3VtbWFyeVtdPjtcbn1cblxuZXhwb3J0IGNsYXNzIExhenlMaXN0U3RhY2tSZXNvdXJjZXMgaW1wbGVtZW50cyBMaXN0U3RhY2tSZXNvdXJjZXMge1xuICBwcml2YXRlIHN0YWNrUmVzb3VyY2VzOiBQcm9taXNlPFN0YWNrUmVzb3VyY2VTdW1tYXJ5W10+IHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgc2RrOiBTREssXG4gICAgcHJpdmF0ZSByZWFkb25seSBzdGFja05hbWU6IHN0cmluZyxcbiAgKSB7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgbGlzdFN0YWNrUmVzb3VyY2VzKCk6IFByb21pc2U8U3RhY2tSZXNvdXJjZVN1bW1hcnlbXT4ge1xuICAgIGlmICh0aGlzLnN0YWNrUmVzb3VyY2VzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuc3RhY2tSZXNvdXJjZXMgPSB0aGlzLnNkay5jbG91ZEZvcm1hdGlvbigpLmxpc3RTdGFja1Jlc291cmNlcyh7XG4gICAgICAgIFN0YWNrTmFtZTogdGhpcy5zdGFja05hbWUsXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuc3RhY2tSZXNvdXJjZXM7XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBMb29rdXBFeHBvcnQge1xuICBsb29rdXBFeHBvcnQobmFtZTogc3RyaW5nKTogUHJvbWlzZTxFeHBvcnQgfCB1bmRlZmluZWQ+O1xufVxuXG5leHBvcnQgY2xhc3MgTG9va3VwRXhwb3J0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG59XG5cbmV4cG9ydCBjbGFzcyBMYXp5TG9va3VwRXhwb3J0IGltcGxlbWVudHMgTG9va3VwRXhwb3J0IHtcbiAgcHJpdmF0ZSBjYWNoZWRFeHBvcnRzOiB7IFtuYW1lOiBzdHJpbmddOiBFeHBvcnQgfSA9IHt9O1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgc2RrOiBTREspIHtcbiAgfVxuXG4gIGFzeW5jIGxvb2t1cEV4cG9ydChuYW1lOiBzdHJpbmcpOiBQcm9taXNlPEV4cG9ydCB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICh0aGlzLmNhY2hlZEV4cG9ydHNbbmFtZV0pIHtcbiAgICAgIHJldHVybiB0aGlzLmNhY2hlZEV4cG9ydHNbbmFtZV07XG4gICAgfVxuXG4gICAgZm9yIGF3YWl0IChjb25zdCBjZm5FeHBvcnQgb2YgdGhpcy5saXN0RXhwb3J0cygpKSB7XG4gICAgICBpZiAoIWNmbkV4cG9ydC5OYW1lKSB7XG4gICAgICAgIGNvbnRpbnVlOyAvLyBpZ25vcmUgYW55IHJlc3VsdCB0aGF0IG9taXRzIGEgbmFtZVxuICAgICAgfVxuICAgICAgdGhpcy5jYWNoZWRFeHBvcnRzW2NmbkV4cG9ydC5OYW1lXSA9IGNmbkV4cG9ydDtcblxuICAgICAgaWYgKGNmbkV4cG9ydC5OYW1lID09PSBuYW1lKSB7XG4gICAgICAgIHJldHVybiBjZm5FeHBvcnQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gZXhwb3J0IG5vdCBmb3VuZFxuICB9XG5cbiAgLy8gVE9ETzogUGFnaW5hdGVcbiAgcHJpdmF0ZSBhc3luYyAqbGlzdEV4cG9ydHMoKSB7XG4gICAgbGV0IG5leHRUb2tlbjogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCByZXNwb25zZTogTGlzdEV4cG9ydHNDb21tYW5kT3V0cHV0ID0gYXdhaXQgdGhpcy5zZGsuY2xvdWRGb3JtYXRpb24oKS5saXN0RXhwb3J0cyh7IE5leHRUb2tlbjogbmV4dFRva2VuIH0pO1xuICAgICAgZm9yIChjb25zdCBjZm5FeHBvcnQgb2YgcmVzcG9uc2UuRXhwb3J0cyA/PyBbXSkge1xuICAgICAgICB5aWVsZCBjZm5FeHBvcnQ7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVzcG9uc2UuTmV4dFRva2VuKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIG5leHRUb2tlbiA9IHJlc3BvbnNlLk5leHRUb2tlbjtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIENmbkV2YWx1YXRpb25FeGNlcHRpb24gZXh0ZW5kcyBFcnJvciB7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb3VyY2VEZWZpbml0aW9uIHtcbiAgcmVhZG9ubHkgTG9naWNhbElkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IFR5cGU6IHN0cmluZztcbiAgcmVhZG9ubHkgUHJvcGVydGllczogeyBbcDogc3RyaW5nXTogYW55IH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlUHJvcHMge1xuICByZWFkb25seSBzdGFja0FydGlmYWN0OiBDbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q7XG4gIHJlYWRvbmx5IHN0YWNrTmFtZT86IHN0cmluZztcbiAgcmVhZG9ubHkgdGVtcGxhdGU/OiBUZW1wbGF0ZTtcbiAgcmVhZG9ubHkgcGFyYW1ldGVyczogeyBbcGFyYW1ldGVyTmFtZTogc3RyaW5nXTogc3RyaW5nIH07XG4gIHJlYWRvbmx5IGFjY291bnQ6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVnaW9uOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHBhcnRpdGlvbjogc3RyaW5nO1xuICByZWFkb25seSBzZGs6IFNESztcbiAgcmVhZG9ubHkgbmVzdGVkU3RhY2tzPzoge1xuICAgIFtuZXN0ZWRTdGFja0xvZ2ljYWxJZDogc3RyaW5nXTogTmVzdGVkU3RhY2tUZW1wbGF0ZXM7XG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUge1xuICBwdWJsaWMgcmVhZG9ubHkgc3RhY2tBcnRpZmFjdDogQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0O1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YWNrTmFtZTogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHRlbXBsYXRlOiBUZW1wbGF0ZTtcbiAgcHJpdmF0ZSByZWFkb25seSBjb250ZXh0OiB7IFtrOiBzdHJpbmddOiBhbnkgfTtcbiAgcHJpdmF0ZSByZWFkb25seSBhY2NvdW50OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVnaW9uOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGFydGl0aW9uOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2RrOiBTREs7XG4gIHByaXZhdGUgcmVhZG9ubHkgbmVzdGVkU3RhY2tzOiB7XG4gICAgW25lc3RlZFN0YWNrTG9naWNhbElkOiBzdHJpbmddOiBOZXN0ZWRTdGFja1RlbXBsYXRlcztcbiAgfTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdGFja1Jlc291cmNlczogTGlzdFN0YWNrUmVzb3VyY2VzO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvb2t1cEV4cG9ydDogTG9va3VwRXhwb3J0O1xuXG4gIHByaXZhdGUgY2FjaGVkVXJsU3VmZml4OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IocHJvcHM6IEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZVByb3BzKSB7XG4gICAgdGhpcy5zdGFja0FydGlmYWN0ID0gcHJvcHMuc3RhY2tBcnRpZmFjdDtcbiAgICB0aGlzLnN0YWNrTmFtZSA9IHByb3BzLnN0YWNrTmFtZSA/PyBwcm9wcy5zdGFja0FydGlmYWN0LnN0YWNrTmFtZTtcbiAgICB0aGlzLnRlbXBsYXRlID0gcHJvcHMudGVtcGxhdGUgPz8gcHJvcHMuc3RhY2tBcnRpZmFjdC50ZW1wbGF0ZTtcbiAgICB0aGlzLmNvbnRleHQgPSB7XG4gICAgICAnQVdTOjpBY2NvdW50SWQnOiBwcm9wcy5hY2NvdW50LFxuICAgICAgJ0FXUzo6UmVnaW9uJzogcHJvcHMucmVnaW9uLFxuICAgICAgJ0FXUzo6UGFydGl0aW9uJzogcHJvcHMucGFydGl0aW9uLFxuICAgICAgLi4ucHJvcHMucGFyYW1ldGVycyxcbiAgICB9O1xuICAgIHRoaXMuYWNjb3VudCA9IHByb3BzLmFjY291bnQ7XG4gICAgdGhpcy5yZWdpb24gPSBwcm9wcy5yZWdpb247XG4gICAgdGhpcy5wYXJ0aXRpb24gPSBwcm9wcy5wYXJ0aXRpb247XG4gICAgdGhpcy5zZGsgPSBwcm9wcy5zZGs7XG5cbiAgICAvLyBXZSBuZWVkIG5hbWVzIG9mIG5lc3RlZCBzdGFjayBzbyB3ZSBjYW4gZXZhbHVhdGUgY3Jvc3Mgc3RhY2sgcmVmZXJlbmNlc1xuICAgIHRoaXMubmVzdGVkU3RhY2tzID0gcHJvcHMubmVzdGVkU3RhY2tzID8/IHt9O1xuXG4gICAgLy8gVGhlIGN1cnJlbnQgcmVzb3VyY2VzIG9mIHRoZSBTdGFjay5cbiAgICAvLyBXZSBuZWVkIHRoZW0gdG8gZmlndXJlIG91dCB0aGUgcGh5c2ljYWwgbmFtZSBvZiBhIHJlc291cmNlIGluIGNhc2UgaXQgd2Fzbid0IHNwZWNpZmllZCBieSB0aGUgdXNlci5cbiAgICAvLyBXZSBmZXRjaCBpdCBsYXppbHksIHRvIHNhdmUgYSBzZXJ2aWNlIGNhbGwsIGluIGNhc2UgYWxsIGhvdHN3YXBwZWQgcmVzb3VyY2VzIGhhdmUgdGhlaXIgcGh5c2ljYWwgbmFtZXMgc2V0LlxuICAgIHRoaXMuc3RhY2tSZXNvdXJjZXMgPSBuZXcgTGF6eUxpc3RTdGFja1Jlc291cmNlcyh0aGlzLnNkaywgdGhpcy5zdGFja05hbWUpO1xuXG4gICAgLy8gQ2xvdWRGb3JtYXRpb24gRXhwb3J0cyBsb29rdXAgdG8gYmUgYWJsZSB0byByZXNvbHZlIEZuOjpJbXBvcnRWYWx1ZSBpbnRyaW5zaWNzIGluIHRlbXBsYXRlXG4gICAgdGhpcy5sb29rdXBFeHBvcnQgPSBuZXcgTGF6eUxvb2t1cEV4cG9ydCh0aGlzLnNkayk7XG4gIH1cblxuICAvLyBjbG9uZXMgY3VycmVudCBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUgb2JqZWN0LCBidXQgdXBkYXRlcyB0aGUgc3RhY2sgbmFtZVxuICBwdWJsaWMgYXN5bmMgY3JlYXRlTmVzdGVkRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlKFxuICAgIHN0YWNrTmFtZTogc3RyaW5nLFxuICAgIG5lc3RlZFRlbXBsYXRlOiBUZW1wbGF0ZSxcbiAgICBuZXN0ZWRTdGFja1BhcmFtZXRlcnM6IHsgW3BhcmFtZXRlck5hbWU6IHN0cmluZ106IGFueSB9LFxuICApIHtcbiAgICBjb25zdCBldmFsdWF0ZWRQYXJhbXMgPSBhd2FpdCB0aGlzLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbihuZXN0ZWRTdGFja1BhcmFtZXRlcnMpO1xuICAgIHJldHVybiBuZXcgRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlKHtcbiAgICAgIHN0YWNrQXJ0aWZhY3Q6IHRoaXMuc3RhY2tBcnRpZmFjdCxcbiAgICAgIHN0YWNrTmFtZSxcbiAgICAgIHRlbXBsYXRlOiBuZXN0ZWRUZW1wbGF0ZSxcbiAgICAgIHBhcmFtZXRlcnM6IGV2YWx1YXRlZFBhcmFtcyxcbiAgICAgIGFjY291bnQ6IHRoaXMuYWNjb3VudCxcbiAgICAgIHJlZ2lvbjogdGhpcy5yZWdpb24sXG4gICAgICBwYXJ0aXRpb246IHRoaXMucGFydGl0aW9uLFxuICAgICAgc2RrOiB0aGlzLnNkayxcbiAgICAgIG5lc3RlZFN0YWNrczogdGhpcy5uZXN0ZWRTdGFja3MsXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZXN0YWJsaXNoUmVzb3VyY2VQaHlzaWNhbE5hbWUoXG4gICAgbG9naWNhbElkOiBzdHJpbmcsXG4gICAgcGh5c2ljYWxOYW1lSW5DZm5UZW1wbGF0ZTogYW55LFxuICApOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGlmIChwaHlzaWNhbE5hbWVJbkNmblRlbXBsYXRlICE9IG51bGwpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbihwaHlzaWNhbE5hbWVJbkNmblRlbXBsYXRlKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gSWYgd2UgY2FuJ3QgZXZhbHVhdGUgdGhlIHJlc291cmNlJ3MgbmFtZSBDbG91ZEZvcm1hdGlvbiBleHByZXNzaW9uLFxuICAgICAgICAvLyBqdXN0IGxvb2sgaXQgdXAgaW4gdGhlIGN1cnJlbnRseSBkZXBsb3llZCBTdGFja1xuICAgICAgICBpZiAoIShlIGluc3RhbmNlb2YgQ2ZuRXZhbHVhdGlvbkV4Y2VwdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmZpbmRQaHlzaWNhbE5hbWVGb3IobG9naWNhbElkKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBmaW5kUGh5c2ljYWxOYW1lRm9yKGxvZ2ljYWxJZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBzdGFja1Jlc291cmNlcyA9IGF3YWl0IHRoaXMuc3RhY2tSZXNvdXJjZXMubGlzdFN0YWNrUmVzb3VyY2VzKCk7XG4gICAgcmV0dXJuIHN0YWNrUmVzb3VyY2VzLmZpbmQoKHNyKSA9PiBzci5Mb2dpY2FsUmVzb3VyY2VJZCA9PT0gbG9naWNhbElkKT8uUGh5c2ljYWxSZXNvdXJjZUlkO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGZpbmRMb2dpY2FsSWRGb3JQaHlzaWNhbE5hbWUocGh5c2ljYWxOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IHN0YWNrUmVzb3VyY2VzID0gYXdhaXQgdGhpcy5zdGFja1Jlc291cmNlcy5saXN0U3RhY2tSZXNvdXJjZXMoKTtcbiAgICByZXR1cm4gc3RhY2tSZXNvdXJjZXMuZmluZCgoc3IpID0+IHNyLlBoeXNpY2FsUmVzb3VyY2VJZCA9PT0gcGh5c2ljYWxOYW1lKT8uTG9naWNhbFJlc291cmNlSWQ7XG4gIH1cblxuICBwdWJsaWMgZmluZFJlZmVyZW5jZXNUbyhsb2dpY2FsSWQ6IHN0cmluZyk6IEFycmF5PFJlc291cmNlRGVmaW5pdGlvbj4ge1xuICAgIGNvbnN0IHJldCA9IG5ldyBBcnJheTxSZXNvdXJjZURlZmluaXRpb24+KCk7XG4gICAgZm9yIChjb25zdCBbcmVzb3VyY2VMb2dpY2FsSWQsIHJlc291cmNlRGVmXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLnRlbXBsYXRlPy5SZXNvdXJjZXMgPz8ge30pKSB7XG4gICAgICBpZiAobG9naWNhbElkICE9PSByZXNvdXJjZUxvZ2ljYWxJZCAmJiB0aGlzLnJlZmVyZW5jZXMobG9naWNhbElkLCByZXNvdXJjZURlZikpIHtcbiAgICAgICAgcmV0LnB1c2goe1xuICAgICAgICAgIC4uLihyZXNvdXJjZURlZiBhcyBhbnkpLFxuICAgICAgICAgIExvZ2ljYWxJZDogcmVzb3VyY2VMb2dpY2FsSWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV0O1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGV2YWx1YXRlQ2ZuRXhwcmVzc2lvbihjZm5FeHByZXNzaW9uOiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIC8qKlxuICAgICAqIEV2YWx1YXRlcyBDbG91ZEZvcm1hdGlvbiBpbnRyaW5zaWMgZnVuY3Rpb25zXG4gICAgICpcbiAgICAgKiBOb3RlIHRoYXQgc3VwcG9ydGVkIGludHJpbnNpYyBmdW5jdGlvbnMgYXJlIGRvY3VtZW50ZWQgaW4gUkVBRE1FLm1kIC0tIHBsZWFzZSB1cGRhdGVcbiAgICAgKiBsaXN0IG9mIHN1cHBvcnRlZCBmdW5jdGlvbnMgd2hlbiBhZGRpbmcgbmV3IGV2YWx1YXRpb25zXG4gICAgICpcbiAgICAgKiBTZWU6IGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BV1NDbG91ZEZvcm1hdGlvbi9sYXRlc3QvVXNlckd1aWRlL2ludHJpbnNpYy1mdW5jdGlvbi1yZWZlcmVuY2UuaHRtbFxuICAgICAqL1xuICAgIGNsYXNzIENmbkludHJpbnNpY3Mge1xuICAgICAgcHVibGljIGV2YWx1YXRlSW50cmluc2ljKGludHJpbnNpYzogSW50cmluc2ljKTogYW55IHtcbiAgICAgICAgY29uc3QgaW50cmluc2ljRnVuYyA9ICh0aGlzIGFzIGFueSlbaW50cmluc2ljLm5hbWVdO1xuICAgICAgICBpZiAoIWludHJpbnNpY0Z1bmMpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQ2ZuRXZhbHVhdGlvbkV4Y2VwdGlvbihgQ2xvdWRGb3JtYXRpb24gZnVuY3Rpb24gJHtpbnRyaW5zaWMubmFtZX0gaXMgbm90IHN1cHBvcnRlZGApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXJnc0FzQXJyYXkgPSBBcnJheS5pc0FycmF5KGludHJpbnNpYy5hcmdzKSA/IGludHJpbnNpYy5hcmdzIDogW2ludHJpbnNpYy5hcmdzXTtcblxuICAgICAgICByZXR1cm4gaW50cmluc2ljRnVuYy5hcHBseSh0aGlzLCBhcmdzQXNBcnJheSk7XG4gICAgICB9XG5cbiAgICAgIGFzeW5jICdGbjo6Sm9pbicoc2VwYXJhdG9yOiBzdHJpbmcsIGFyZ3M6IGFueVtdKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgZXZhbHVhdGVkQXJncyA9IGF3YWl0IHNlbGYuZXZhbHVhdGVDZm5FeHByZXNzaW9uKGFyZ3MpO1xuICAgICAgICByZXR1cm4gZXZhbHVhdGVkQXJncy5qb2luKHNlcGFyYXRvcik7XG4gICAgICB9XG5cbiAgICAgIGFzeW5jICdGbjo6U3BsaXQnKHNlcGFyYXRvcjogc3RyaW5nLCBhcmdzOiBhbnkpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgICAgICBjb25zdCBldmFsdWF0ZWRBcmdzID0gYXdhaXQgc2VsZi5ldmFsdWF0ZUNmbkV4cHJlc3Npb24oYXJncyk7XG4gICAgICAgIHJldHVybiBldmFsdWF0ZWRBcmdzLnNwbGl0KHNlcGFyYXRvcik7XG4gICAgICB9XG5cbiAgICAgIGFzeW5jICdGbjo6U2VsZWN0JyhpbmRleDogbnVtYmVyLCBhcmdzOiBhbnlbXSk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgICAgIGNvbnN0IGV2YWx1YXRlZEFyZ3MgPSBhd2FpdCBzZWxmLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbihhcmdzKTtcbiAgICAgICAgcmV0dXJuIGV2YWx1YXRlZEFyZ3NbaW5kZXhdO1xuICAgICAgfVxuXG4gICAgICBhc3luYyBSZWYobG9naWNhbElkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgICAgICBjb25zdCByZWZUYXJnZXQgPSBhd2FpdCBzZWxmLmZpbmRSZWZUYXJnZXQobG9naWNhbElkKTtcbiAgICAgICAgaWYgKHJlZlRhcmdldCkge1xuICAgICAgICAgIHJldHVybiByZWZUYXJnZXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IENmbkV2YWx1YXRpb25FeGNlcHRpb24oYFBhcmFtZXRlciBvciByZXNvdXJjZSAnJHtsb2dpY2FsSWR9JyBjb3VsZCBub3QgYmUgZm91bmQgZm9yIGV2YWx1YXRpb25gKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBhc3luYyAnRm46OkdldEF0dCcobG9naWNhbElkOiBzdHJpbmcsIGF0dHJpYnV0ZU5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgICAgIC8vIFRvRG8gaGFuZGxlIHRoZSAnbG9naWNhbElkLmF0dHJpYnV0ZU5hbWUnIGZvcm0gb2YgRm46OkdldEF0dFxuICAgICAgICBjb25zdCBhdHRyVmFsdWUgPSBhd2FpdCBzZWxmLmZpbmRHZXRBdHRUYXJnZXQobG9naWNhbElkLCBhdHRyaWJ1dGVOYW1lKTtcbiAgICAgICAgaWYgKGF0dHJWYWx1ZSkge1xuICAgICAgICAgIHJldHVybiBhdHRyVmFsdWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IENmbkV2YWx1YXRpb25FeGNlcHRpb24oXG4gICAgICAgICAgICBgQXR0cmlidXRlICcke2F0dHJpYnV0ZU5hbWV9JyBvZiByZXNvdXJjZSAnJHtsb2dpY2FsSWR9JyBjb3VsZCBub3QgYmUgZm91bmQgZm9yIGV2YWx1YXRpb25gLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgYXN5bmMgJ0ZuOjpTdWInKHRlbXBsYXRlOiBzdHJpbmcsIGV4cGxpY2l0UGxhY2Vob2xkZXJzPzogeyBbdmFyaWFibGU6IHN0cmluZ106IHN0cmluZyB9KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgcGxhY2Vob2xkZXJzID0gZXhwbGljaXRQbGFjZWhvbGRlcnMgPyBhd2FpdCBzZWxmLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbihleHBsaWNpdFBsYWNlaG9sZGVycykgOiB7fTtcblxuICAgICAgICByZXR1cm4gYXN5bmNHbG9iYWxSZXBsYWNlKHRlbXBsYXRlLCAvXFwkeyhbXn1dKil9L2csIChrZXkpID0+IHtcbiAgICAgICAgICBpZiAoa2V5IGluIHBsYWNlaG9sZGVycykge1xuICAgICAgICAgICAgcmV0dXJuIHBsYWNlaG9sZGVyc1trZXldO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBzcGxpdEtleSA9IGtleS5zcGxpdCgnLicpO1xuICAgICAgICAgICAgcmV0dXJuIHNwbGl0S2V5Lmxlbmd0aCA9PT0gMSA/IHRoaXMuUmVmKGtleSkgOiB0aGlzWydGbjo6R2V0QXR0J10oc3BsaXRLZXlbMF0sIHNwbGl0S2V5LnNsaWNlKDEpLmpvaW4oJy4nKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgYXN5bmMgJ0ZuOjpJbXBvcnRWYWx1ZScobmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICAgICAgY29uc3QgZXhwb3J0ZWQgPSBhd2FpdCBzZWxmLmxvb2t1cEV4cG9ydC5sb29rdXBFeHBvcnQobmFtZSk7XG4gICAgICAgIGlmICghZXhwb3J0ZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgQ2ZuRXZhbHVhdGlvbkV4Y2VwdGlvbihgRXhwb3J0ICcke25hbWV9JyBjb3VsZCBub3QgYmUgZm91bmQgZm9yIGV2YWx1YXRpb25gKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWV4cG9ydGVkLlZhbHVlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IENmbkV2YWx1YXRpb25FeGNlcHRpb24oYEV4cG9ydCAnJHtuYW1lfScgZXhpc3RzIHdpdGhvdXQgYSB2YWx1ZWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBleHBvcnRlZC5WYWx1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY2ZuRXhwcmVzc2lvbiA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gY2ZuRXhwcmVzc2lvbjtcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShjZm5FeHByZXNzaW9uKSkge1xuICAgICAgLy8gU21hbGwgYXJyYXlzIGluIHByYWN0aWNlXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQGNka2xhYnMvcHJvbWlzZWFsbC1uby11bmJvdW5kZWQtcGFyYWxsZWxpc21cbiAgICAgIHJldHVybiBQcm9taXNlLmFsbChjZm5FeHByZXNzaW9uLm1hcCgoZXhwcikgPT4gdGhpcy5ldmFsdWF0ZUNmbkV4cHJlc3Npb24oZXhwcikpKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNmbkV4cHJlc3Npb24gPT09ICdvYmplY3QnKSB7XG4gICAgICBjb25zdCBpbnRyaW5zaWMgPSB0aGlzLnBhcnNlSW50cmluc2ljKGNmbkV4cHJlc3Npb24pO1xuICAgICAgaWYgKGludHJpbnNpYykge1xuICAgICAgICByZXR1cm4gbmV3IENmbkludHJpbnNpY3MoKS5ldmFsdWF0ZUludHJpbnNpYyhpbnRyaW5zaWMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgcmV0OiB7IFtrZXk6IHN0cmluZ106IGFueSB9ID0ge307XG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsXSBvZiBPYmplY3QuZW50cmllcyhjZm5FeHByZXNzaW9uKSkge1xuICAgICAgICAgIHJldFtrZXldID0gYXdhaXQgdGhpcy5ldmFsdWF0ZUNmbkV4cHJlc3Npb24odmFsKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmV0O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjZm5FeHByZXNzaW9uO1xuICB9XG5cbiAgcHVibGljIGdldFJlc291cmNlUHJvcGVydHkobG9naWNhbElkOiBzdHJpbmcsIHByb3BlcnR5TmFtZTogc3RyaW5nKTogYW55IHtcbiAgICByZXR1cm4gdGhpcy50ZW1wbGF0ZS5SZXNvdXJjZXM/Lltsb2dpY2FsSWRdPy5Qcm9wZXJ0aWVzPy5bcHJvcGVydHlOYW1lXTtcbiAgfVxuXG4gIHB1YmxpYyBtZXRhZGF0YUZvcihsb2dpY2FsSWQ6IHN0cmluZyk6IFJlc291cmNlTWV0YWRhdGEgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiByZXNvdXJjZU1ldGFkYXRhKHRoaXMuc3RhY2tBcnRpZmFjdCwgbG9naWNhbElkKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVmZXJlbmNlcyhsb2dpY2FsSWQ6IHN0cmluZywgdGVtcGxhdGVFbGVtZW50OiBhbnkpOiBib29sZWFuIHtcbiAgICBpZiAodHlwZW9mIHRlbXBsYXRlRWxlbWVudCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBsb2dpY2FsSWQgPT09IHRlbXBsYXRlRWxlbWVudDtcbiAgICB9XG5cbiAgICBpZiAodGVtcGxhdGVFbGVtZW50ID09IG51bGwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh0ZW1wbGF0ZUVsZW1lbnQpKSB7XG4gICAgICByZXR1cm4gdGVtcGxhdGVFbGVtZW50LnNvbWUoKGVsKSA9PiB0aGlzLnJlZmVyZW5jZXMobG9naWNhbElkLCBlbCkpO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdGVtcGxhdGVFbGVtZW50ID09PSAnb2JqZWN0Jykge1xuICAgICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGVtcGxhdGVFbGVtZW50KS5zb21lKChlbCkgPT4gdGhpcy5yZWZlcmVuY2VzKGxvZ2ljYWxJZCwgZWwpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwcml2YXRlIHBhcnNlSW50cmluc2ljKHg6IGFueSk6IEludHJpbnNpYyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHgpO1xuICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMSAmJiAoa2V5c1swXS5zdGFydHNXaXRoKCdGbjo6JykgfHwga2V5c1swXSA9PT0gJ1JlZicpKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBuYW1lOiBrZXlzWzBdLFxuICAgICAgICBhcmdzOiB4W2tleXNbMF1dLFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmluZFJlZlRhcmdldChsb2dpY2FsSWQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgLy8gZmlyc3QsIGNoZWNrIHRvIHNlZSBpZiB0aGUgUmVmIGlzIGEgUGFyYW1ldGVyIHdobydzIHZhbHVlIHdlIGhhdmVcbiAgICBpZiAobG9naWNhbElkID09PSAnQVdTOjpVUkxTdWZmaXgnKSB7XG4gICAgICBpZiAoIXRoaXMuY2FjaGVkVXJsU3VmZml4KSB7XG4gICAgICAgIHRoaXMuY2FjaGVkVXJsU3VmZml4ID0gYXdhaXQgdGhpcy5zZGsuZ2V0VXJsU3VmZml4KHRoaXMucmVnaW9uKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXMuY2FjaGVkVXJsU3VmZml4O1xuICAgIH1cblxuICAgIC8vIFRyeSBmaW5kaW5nIHRoZSByZWYgaW4gdGhlIHBhc3NlZCBpbiBwYXJhbWV0ZXJzXG4gICAgY29uc3QgcGFyYW1ldGVyVGFyZ2V0ID0gdGhpcy5jb250ZXh0W2xvZ2ljYWxJZF07XG4gICAgaWYgKHBhcmFtZXRlclRhcmdldCkge1xuICAgICAgcmV0dXJuIHBhcmFtZXRlclRhcmdldDtcbiAgICB9XG5cbiAgICAvLyBJZiBub3QgaW4gdGhlIHBhc3NlZCBpbiBwYXJhbWV0ZXJzLCBzZWUgaWYgdGhlcmUgaXMgYSBkZWZhdWx0IHZhbHVlIGluIHRoZSB0ZW1wbGF0ZSBwYXJhbWV0ZXIgdGhhdCB3YXMgbm90IHBhc3NlZCBpblxuICAgIGNvbnN0IGRlZmF1bHRQYXJhbWV0ZXJWYWx1ZSA9IHRoaXMudGVtcGxhdGUuUGFyYW1ldGVycz8uW2xvZ2ljYWxJZF0/LkRlZmF1bHQ7XG4gICAgaWYgKGRlZmF1bHRQYXJhbWV0ZXJWYWx1ZSkge1xuICAgICAgcmV0dXJuIGRlZmF1bHRQYXJhbWV0ZXJWYWx1ZTtcbiAgICB9XG5cbiAgICAvLyBpZiBpdCdzIG5vdCBhIFBhcmFtZXRlciwgd2UgbmVlZCB0byBzZWFyY2ggaW4gdGhlIGN1cnJlbnQgU3RhY2sgcmVzb3VyY2VzXG4gICAgcmV0dXJuIHRoaXMuZmluZEdldEF0dFRhcmdldChsb2dpY2FsSWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmaW5kR2V0QXR0VGFyZ2V0KGxvZ2ljYWxJZDogc3RyaW5nLCBhdHRyaWJ1dGU/OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIC8vIEhhbmRsZSBjYXNlIHdoZXJlIHRoZSBhdHRyaWJ1dGUgaXMgcmVmZXJlbmNpbmcgYSBzdGFjayBvdXRwdXQgKHVzZWQgaW4gbmVzdGVkIHN0YWNrcyB0byBzaGFyZSBwYXJhbWV0ZXJzKVxuICAgIC8vIFNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTQ2xvdWRGb3JtYXRpb24vbGF0ZXN0L1VzZXJHdWlkZS9xdWlja3JlZi1jbG91ZGZvcm1hdGlvbi5odG1sI3cyYWIxYzE3YzIzYzE5YjVcbiAgICBpZiAobG9naWNhbElkID09PSAnT3V0cHV0cycgJiYgYXR0cmlidXRlKSB7XG4gICAgICByZXR1cm4gdGhpcy5ldmFsdWF0ZUNmbkV4cHJlc3Npb24odGhpcy50ZW1wbGF0ZS5PdXRwdXRzW2F0dHJpYnV0ZV0/LlZhbHVlKTtcbiAgICB9XG5cbiAgICBjb25zdCBzdGFja1Jlc291cmNlcyA9IGF3YWl0IHRoaXMuc3RhY2tSZXNvdXJjZXMubGlzdFN0YWNrUmVzb3VyY2VzKCk7XG4gICAgY29uc3QgZm91bmRSZXNvdXJjZSA9IHN0YWNrUmVzb3VyY2VzLmZpbmQoKHNyKSA9PiBzci5Mb2dpY2FsUmVzb3VyY2VJZCA9PT0gbG9naWNhbElkKTtcbiAgICBpZiAoIWZvdW5kUmVzb3VyY2UpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgaWYgKGZvdW5kUmVzb3VyY2UuUmVzb3VyY2VUeXBlID09ICdBV1M6OkNsb3VkRm9ybWF0aW9uOjpTdGFjaycgJiYgYXR0cmlidXRlPy5zdGFydHNXaXRoKCdPdXRwdXRzLicpKSB7XG4gICAgICBjb25zdCBkZXBlbmRhbnRTdGFjayA9IHRoaXMuZmluZE5lc3RlZFN0YWNrKGxvZ2ljYWxJZCwgdGhpcy5uZXN0ZWRTdGFja3MpO1xuICAgICAgaWYgKCFkZXBlbmRhbnRTdGFjayB8fCAhZGVwZW5kYW50U3RhY2sucGh5c2ljYWxOYW1lKSB7XG4gICAgICAgIC8vIHRoaXMgaXMgYSBuZXdseSBjcmVhdGVkIG5lc3RlZCBzdGFjayBhbmQgY2Fubm90IGJlIGhvdHN3YXBwZWRcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUgPSBhd2FpdCB0aGlzLmNyZWF0ZU5lc3RlZEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZShcbiAgICAgICAgZGVwZW5kYW50U3RhY2sucGh5c2ljYWxOYW1lLFxuICAgICAgICBkZXBlbmRhbnRTdGFjay5nZW5lcmF0ZWRUZW1wbGF0ZSxcbiAgICAgICAgZGVwZW5kYW50U3RhY2suZ2VuZXJhdGVkVGVtcGxhdGUuUGFyYW1ldGVycyEsXG4gICAgICApO1xuXG4gICAgICAvLyBTcGxpdCBPdXRwdXRzLjxyZWZOYW1lPiBpbnRvICdPdXRwdXRzJyBhbmQgJzxyZWZOYW1lPicgYW5kIHJlY3Vyc2l2ZWx5IGNhbGwgZXZhbHVhdGVcbiAgICAgIHJldHVybiBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih7XG4gICAgICAgICdGbjo6R2V0QXR0JzogYXR0cmlidXRlLnNwbGl0KC9cXC4oLiopL3MpLFxuICAgICAgfSk7XG4gICAgfVxuICAgIC8vIG5vdywgd2UgbmVlZCB0byBmb3JtYXQgdGhlIGFwcHJvcHJpYXRlIGlkZW50aWZpZXIgZGVwZW5kaW5nIG9uIHRoZSByZXNvdXJjZSB0eXBlLFxuICAgIC8vIGFuZCB0aGUgcmVxdWVzdGVkIGF0dHJpYnV0ZSBuYW1lXG4gICAgcmV0dXJuIHRoaXMuZm9ybWF0UmVzb3VyY2VBdHRyaWJ1dGUoZm91bmRSZXNvdXJjZSwgYXR0cmlidXRlKTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZE5lc3RlZFN0YWNrKFxuICAgIGxvZ2ljYWxJZDogc3RyaW5nLFxuICAgIG5lc3RlZFN0YWNrczoge1xuICAgICAgW25lc3RlZFN0YWNrTG9naWNhbElkOiBzdHJpbmddOiBOZXN0ZWRTdGFja1RlbXBsYXRlcztcbiAgICB9LFxuICApOiBOZXN0ZWRTdGFja1RlbXBsYXRlcyB8IHVuZGVmaW5lZCB7XG4gICAgZm9yIChjb25zdCBuZXN0ZWRTdGFja0xvZ2ljYWxJZCBvZiBPYmplY3Qua2V5cyhuZXN0ZWRTdGFja3MpKSB7XG4gICAgICBpZiAobmVzdGVkU3RhY2tMb2dpY2FsSWQgPT09IGxvZ2ljYWxJZCkge1xuICAgICAgICByZXR1cm4gbmVzdGVkU3RhY2tzW25lc3RlZFN0YWNrTG9naWNhbElkXTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGNoZWNrSW5OZXN0ZWRDaGlsZFN0YWNrcyA9IHRoaXMuZmluZE5lc3RlZFN0YWNrKFxuICAgICAgICBsb2dpY2FsSWQsXG4gICAgICAgIG5lc3RlZFN0YWNrc1tuZXN0ZWRTdGFja0xvZ2ljYWxJZF0ubmVzdGVkU3RhY2tUZW1wbGF0ZXMsXG4gICAgICApO1xuICAgICAgaWYgKGNoZWNrSW5OZXN0ZWRDaGlsZFN0YWNrcykgcmV0dXJuIGNoZWNrSW5OZXN0ZWRDaGlsZFN0YWNrcztcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0UmVzb3VyY2VBdHRyaWJ1dGUocmVzb3VyY2U6IFN0YWNrUmVzb3VyY2VTdW1tYXJ5LCBhdHRyaWJ1dGU6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgcGh5c2ljYWxJZCA9IHJlc291cmNlLlBoeXNpY2FsUmVzb3VyY2VJZDtcblxuICAgIC8vIG5vIGF0dHJpYnV0ZSBtZWFucyBSZWYgZXhwcmVzc2lvbiwgZm9yIHdoaWNoIHdlIHVzZSB0aGUgcGh5c2ljYWwgSUQgZGlyZWN0bHlcbiAgICBpZiAoIWF0dHJpYnV0ZSkge1xuICAgICAgcmV0dXJuIHBoeXNpY2FsSWQ7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VUeXBlRm9ybWF0cyA9IFJFU09VUkNFX1RZUEVfQVRUUklCVVRFU19GT1JNQVRTW3Jlc291cmNlLlJlc291cmNlVHlwZSFdO1xuICAgIGlmICghcmVzb3VyY2VUeXBlRm9ybWF0cykge1xuICAgICAgdGhyb3cgbmV3IENmbkV2YWx1YXRpb25FeGNlcHRpb24oXG4gICAgICAgIGBXZSBkb24ndCBzdXBwb3J0IGF0dHJpYnV0ZXMgb2YgdGhlICcke3Jlc291cmNlLlJlc291cmNlVHlwZX0nIHJlc291cmNlLiBUaGlzIGlzIGEgQ0RLIGxpbWl0YXRpb24uIGAgK1xuICAgICAgICAgICdQbGVhc2UgcmVwb3J0IGl0IGF0IGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9pc3N1ZXMvbmV3L2Nob29zZScsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBhdHRyaWJ1dGVGbXRGdW5jID0gcmVzb3VyY2VUeXBlRm9ybWF0c1thdHRyaWJ1dGVdO1xuICAgIGlmICghYXR0cmlidXRlRm10RnVuYykge1xuICAgICAgdGhyb3cgbmV3IENmbkV2YWx1YXRpb25FeGNlcHRpb24oXG4gICAgICAgIGBXZSBkb24ndCBzdXBwb3J0IHRoZSAnJHthdHRyaWJ1dGV9JyBhdHRyaWJ1dGUgb2YgdGhlICcke3Jlc291cmNlLlJlc291cmNlVHlwZX0nIHJlc291cmNlLiBUaGlzIGlzIGEgQ0RLIGxpbWl0YXRpb24uIGAgK1xuICAgICAgICAgICdQbGVhc2UgcmVwb3J0IGl0IGF0IGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9pc3N1ZXMvbmV3L2Nob29zZScsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBzZXJ2aWNlID0gdGhpcy5nZXRTZXJ2aWNlT2ZSZXNvdXJjZShyZXNvdXJjZSk7XG4gICAgY29uc3QgcmVzb3VyY2VUeXBlQXJuUGFydCA9IHRoaXMuZ2V0UmVzb3VyY2VUeXBlQXJuUGFydE9mUmVzb3VyY2UocmVzb3VyY2UpO1xuICAgIHJldHVybiBhdHRyaWJ1dGVGbXRGdW5jKHtcbiAgICAgIHBhcnRpdGlvbjogdGhpcy5wYXJ0aXRpb24sXG4gICAgICBzZXJ2aWNlLFxuICAgICAgcmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgIGFjY291bnQ6IHRoaXMuYWNjb3VudCxcbiAgICAgIHJlc291cmNlVHlwZTogcmVzb3VyY2VUeXBlQXJuUGFydCxcbiAgICAgIHJlc291cmNlTmFtZTogcGh5c2ljYWxJZCEsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdldFNlcnZpY2VPZlJlc291cmNlKHJlc291cmNlOiBTdGFja1Jlc291cmNlU3VtbWFyeSk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHJlc291cmNlLlJlc291cmNlVHlwZSEuc3BsaXQoJzo6JylbMV0udG9Mb3dlckNhc2UoKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0UmVzb3VyY2VUeXBlQXJuUGFydE9mUmVzb3VyY2UocmVzb3VyY2U6IFN0YWNrUmVzb3VyY2VTdW1tYXJ5KTogc3RyaW5nIHtcbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSByZXNvdXJjZS5SZXNvdXJjZVR5cGUhO1xuICAgIGNvbnN0IHNwZWNpYWxDYXNlUmVzb3VyY2VUeXBlID0gUkVTT1VSQ0VfVFlQRV9TUEVDSUFMX05BTUVTW3Jlc291cmNlVHlwZV0/LnJlc291cmNlVHlwZTtcbiAgICByZXR1cm4gc3BlY2lhbENhc2VSZXNvdXJjZVR5cGVcbiAgICAgID8gc3BlY2lhbENhc2VSZXNvdXJjZVR5cGVcbiAgICAgIDogLy8gdGhpcyBpcyB0aGUgZGVmYXVsdCBjYXNlXG4gICAgICByZXNvdXJjZVR5cGUuc3BsaXQoJzo6JylbMl0udG9Mb3dlckNhc2UoKTtcbiAgfVxufVxuXG5pbnRlcmZhY2UgQXJuUGFydHMge1xuICByZWFkb25seSBwYXJ0aXRpb246IHN0cmluZztcbiAgcmVhZG9ubHkgc2VydmljZTogc3RyaW5nO1xuICByZWFkb25seSByZWdpb246IHN0cmluZztcbiAgcmVhZG9ubHkgYWNjb3VudDogc3RyaW5nO1xuICByZWFkb25seSByZXNvdXJjZVR5cGU6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVzb3VyY2VOYW1lOiBzdHJpbmc7XG59XG5cbi8qKlxuICogVXN1YWxseSwgd2UgZGVkdWNlIHRoZSBuYW1lcyBvZiB0aGUgc2VydmljZSBhbmQgdGhlIHJlc291cmNlIHR5cGUgdXNlZCB0byBmb3JtYXQgdGhlIEFSTiBmcm9tIHRoZSBDbG91ZEZvcm1hdGlvbiByZXNvdXJjZSB0eXBlLlxuICogRm9yIGEgQ0ZOIHR5cGUgbGlrZSBBV1M6OlNlcnZpY2U6OlJlc291cmNlVHlwZSwgdGhlIHNlY29uZCBzZWdtZW50IGJlY29tZXMgdGhlIHNlcnZpY2UgbmFtZSwgYW5kIHRoZSB0aGlyZCB0aGUgcmVzb3VyY2UgdHlwZVxuICogKGFmdGVyIGNvbnZlcnRpbmcgYm90aCBvZiB0aGVtIHRvIGxvd2VyY2FzZSkuXG4gKiBIb3dldmVyLCBzb21lIHJlc291cmNlIHR5cGVzIGJyZWFrIHRoaXMgc2ltcGxlIGNvbnZlbnRpb24sIGFuZCB3ZSBuZWVkIHRvIHNwZWNpYWwtY2FzZSB0aGVtLlxuICogVGhpcyBtYXAgaXMgZm9yIHN0b3JpbmcgdGhvc2UgY2FzZXMuXG4gKi9cbmNvbnN0IFJFU09VUkNFX1RZUEVfU1BFQ0lBTF9OQU1FUzoge1xuICBbdHlwZTogc3RyaW5nXTogeyByZXNvdXJjZVR5cGU6IHN0cmluZyB9O1xufSA9IHtcbiAgJ0FXUzo6RXZlbnRzOjpFdmVudEJ1cyc6IHtcbiAgICByZXNvdXJjZVR5cGU6ICdldmVudC1idXMnLFxuICB9LFxufTtcblxuY29uc3QgUkVTT1VSQ0VfVFlQRV9BVFRSSUJVVEVTX0ZPUk1BVFM6IHtcbiAgW3R5cGU6IHN0cmluZ106IHsgW2F0dHJpYnV0ZTogc3RyaW5nXTogKHBhcnRzOiBBcm5QYXJ0cykgPT4gc3RyaW5nIH07XG59ID0ge1xuICAnQVdTOjpJQU06OlJvbGUnOiB7IEFybjogaWFtQXJuRm10IH0sXG4gICdBV1M6OklBTTo6VXNlcic6IHsgQXJuOiBpYW1Bcm5GbXQgfSxcbiAgJ0FXUzo6SUFNOjpHcm91cCc6IHsgQXJuOiBpYW1Bcm5GbXQgfSxcbiAgJ0FXUzo6UzM6OkJ1Y2tldCc6IHsgQXJuOiBzM0FybkZtdCB9LFxuICAnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJzogeyBBcm46IHN0ZENvbG9uUmVzb3VyY2VBcm5GbXQgfSxcbiAgJ0FXUzo6RXZlbnRzOjpFdmVudEJ1cyc6IHtcbiAgICBBcm46IHN0ZFNsYXNoUmVzb3VyY2VBcm5GbXQsXG4gICAgLy8gdGhlIG5hbWUgYXR0cmlidXRlIG9mIHRoZSBFdmVudEJ1cyBpcyB0aGUgc2FtZSBhcyB0aGUgUmVmXG4gICAgTmFtZTogKHBhcnRzKSA9PiBwYXJ0cy5yZXNvdXJjZU5hbWUsXG4gIH0sXG4gICdBV1M6OkR5bmFtb0RCOjpUYWJsZSc6IHsgQXJuOiBzdGRTbGFzaFJlc291cmNlQXJuRm10IH0sXG4gICdBV1M6OkFwcFN5bmM6OkdyYXBoUUxBcGknOiB7IEFwaUlkOiBhcHBzeW5jR3JhcGhRbEFwaUFwaUlkRm10IH0sXG4gICdBV1M6OkFwcFN5bmM6OkZ1bmN0aW9uQ29uZmlndXJhdGlvbic6IHtcbiAgICBGdW5jdGlvbklkOiBhcHBzeW5jR3JhcGhRbEZ1bmN0aW9uSURGbXQsXG4gIH0sXG4gICdBV1M6OkFwcFN5bmM6OkRhdGFTb3VyY2UnOiB7IE5hbWU6IGFwcHN5bmNHcmFwaFFsRGF0YVNvdXJjZU5hbWVGbXQgfSxcbiAgJ0FXUzo6S01TOjpLZXknOiB7IEFybjogc3RkU2xhc2hSZXNvdXJjZUFybkZtdCB9LFxufTtcblxuZnVuY3Rpb24gaWFtQXJuRm10KHBhcnRzOiBBcm5QYXJ0cyk6IHN0cmluZyB7XG4gIC8vIHdlIHNraXAgcmVnaW9uIGZvciBJQU0gcmVzb3VyY2VzXG4gIHJldHVybiBgYXJuOiR7cGFydHMucGFydGl0aW9ufToke3BhcnRzLnNlcnZpY2V9Ojoke3BhcnRzLmFjY291bnR9OiR7cGFydHMucmVzb3VyY2VUeXBlfS8ke3BhcnRzLnJlc291cmNlTmFtZX1gO1xufVxuXG5mdW5jdGlvbiBzM0FybkZtdChwYXJ0czogQXJuUGFydHMpOiBzdHJpbmcge1xuICAvLyB3ZSBza2lwIGFjY291bnQsIHJlZ2lvbiBhbmQgcmVzb3VyY2VUeXBlIGZvciBTMyByZXNvdXJjZXNcbiAgcmV0dXJuIGBhcm46JHtwYXJ0cy5wYXJ0aXRpb259OiR7cGFydHMuc2VydmljZX06Ojoke3BhcnRzLnJlc291cmNlTmFtZX1gO1xufVxuXG5mdW5jdGlvbiBzdGRDb2xvblJlc291cmNlQXJuRm10KHBhcnRzOiBBcm5QYXJ0cyk6IHN0cmluZyB7XG4gIC8vIHRoaXMgaXMgYSBzdGFuZGFyZCBmb3JtYXQgZm9yIEFSTnMgbGlrZTogYXJuOmF3czpzZXJ2aWNlOnJlZ2lvbjphY2NvdW50OnJlc291cmNlVHlwZTpyZXNvdXJjZU5hbWVcbiAgcmV0dXJuIGBhcm46JHtwYXJ0cy5wYXJ0aXRpb259OiR7cGFydHMuc2VydmljZX06JHtwYXJ0cy5yZWdpb259OiR7cGFydHMuYWNjb3VudH06JHtwYXJ0cy5yZXNvdXJjZVR5cGV9OiR7cGFydHMucmVzb3VyY2VOYW1lfWA7XG59XG5cbmZ1bmN0aW9uIHN0ZFNsYXNoUmVzb3VyY2VBcm5GbXQocGFydHM6IEFyblBhcnRzKTogc3RyaW5nIHtcbiAgLy8gdGhpcyBpcyBhIHN0YW5kYXJkIGZvcm1hdCBmb3IgQVJOcyBsaWtlOiBhcm46YXdzOnNlcnZpY2U6cmVnaW9uOmFjY291bnQ6cmVzb3VyY2VUeXBlL3Jlc291cmNlTmFtZVxuICByZXR1cm4gYGFybjoke3BhcnRzLnBhcnRpdGlvbn06JHtwYXJ0cy5zZXJ2aWNlfToke3BhcnRzLnJlZ2lvbn06JHtwYXJ0cy5hY2NvdW50fToke3BhcnRzLnJlc291cmNlVHlwZX0vJHtwYXJ0cy5yZXNvdXJjZU5hbWV9YDtcbn1cblxuZnVuY3Rpb24gYXBwc3luY0dyYXBoUWxBcGlBcGlJZEZtdChwYXJ0czogQXJuUGFydHMpOiBzdHJpbmcge1xuICAvLyBhcm46YXdzOmFwcHN5bmM6dXMtZWFzdC0xOjExMTExMTExMTExMTphcGlzLzxhcGlJZD5cbiAgcmV0dXJuIHBhcnRzLnJlc291cmNlTmFtZS5zcGxpdCgnLycpWzFdO1xufVxuXG5mdW5jdGlvbiBhcHBzeW5jR3JhcGhRbEZ1bmN0aW9uSURGbXQocGFydHM6IEFyblBhcnRzKTogc3RyaW5nIHtcbiAgLy8gYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy88YXBpSWQ+L2Z1bmN0aW9ucy88ZnVuY3Rpb25JZD5cbiAgcmV0dXJuIHBhcnRzLnJlc291cmNlTmFtZS5zcGxpdCgnLycpWzNdO1xufVxuXG5mdW5jdGlvbiBhcHBzeW5jR3JhcGhRbERhdGFTb3VyY2VOYW1lRm10KHBhcnRzOiBBcm5QYXJ0cyk6IHN0cmluZyB7XG4gIC8vIGFybjphd3M6YXBwc3luYzp1cy1lYXN0LTE6MTExMTExMTExMTExOmFwaXMvPGFwaUlkPi9kYXRhc291cmNlcy88bmFtZT5cbiAgcmV0dXJuIHBhcnRzLnJlc291cmNlTmFtZS5zcGxpdCgnLycpWzNdO1xufVxuXG5pbnRlcmZhY2UgSW50cmluc2ljIHtcbiAgcmVhZG9ubHkgbmFtZTogc3RyaW5nO1xuICByZWFkb25seSBhcmdzOiBhbnk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFzeW5jR2xvYmFsUmVwbGFjZShzdHI6IHN0cmluZywgcmVnZXg6IFJlZ0V4cCwgY2I6ICh4OiBzdHJpbmcpID0+IFByb21pc2U8c3RyaW5nPik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGlmICghcmVnZXguZ2xvYmFsKSB7XG4gICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcignUmVnZXggbXVzdCBiZSBjcmVhdGVkIHdpdGggL2cgZmxhZycpO1xuICB9XG5cbiAgY29uc3QgcmV0ID0gbmV3IEFycmF5PHN0cmluZz4oKTtcbiAgbGV0IHN0YXJ0ID0gMDtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBjb25zdCBtYXRjaCA9IHJlZ2V4LmV4ZWMoc3RyKTtcbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICBicmVhaztcbiAgICB9XG5cbiAgICByZXQucHVzaChzdHIuc3Vic3RyaW5nKHN0YXJ0LCBtYXRjaC5pbmRleCkpO1xuICAgIHJldC5wdXNoKGF3YWl0IGNiKG1hdGNoWzFdKSk7XG5cbiAgICBzdGFydCA9IHJlZ2V4Lmxhc3RJbmRleDtcbiAgfVxuICByZXQucHVzaChzdHIuc2xpY2Uoc3RhcnQpKTtcblxuICByZXR1cm4gcmV0LmpvaW4oJycpO1xufVxuIl19