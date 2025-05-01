"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHotswappableS3BucketDeploymentChange = isHotswappableS3BucketDeploymentChange;
exports.skipChangeForS3DeployCustomResourcePolicy = skipChangeForS3DeployCustomResourcePolicy;
/**
 * This means that the value is required to exist by CloudFormation's Custom Resource API (or our S3 Bucket Deployment Lambda's API)
 * but the actual value specified is irrelevant
 */
const REQUIRED_BY_CFN = 'required-to-be-present-by-cfn';
const CDK_BUCKET_DEPLOYMENT_CFN_TYPE = 'Custom::CDKBucketDeployment';
async function isHotswappableS3BucketDeploymentChange(logicalId, change, evaluateCfnTemplate) {
    // In old-style synthesis, the policy used by the lambda to copy assets Ref's the assets directly,
    // meaning that the changes made to the Policy are artifacts that can be safely ignored
    const ret = [];
    if (change.newValue.Type !== CDK_BUCKET_DEPLOYMENT_CFN_TYPE) {
        return [];
    }
    // no classification to be done here; all the properties of this custom resource thing are hotswappable
    const customResourceProperties = await evaluateCfnTemplate.evaluateCfnExpression({
        ...change.newValue.Properties,
        ServiceToken: undefined,
    });
    // note that this gives the ARN of the lambda, not the name. This is fine though, the invoke() sdk call will take either
    const functionName = await evaluateCfnTemplate.evaluateCfnExpression(change.newValue.Properties?.ServiceToken);
    if (!functionName) {
        return ret;
    }
    ret.push({
        change: {
            cause: change,
            resources: [{
                    logicalId,
                    physicalName: customResourceProperties.DestinationBucketName,
                    resourceType: CDK_BUCKET_DEPLOYMENT_CFN_TYPE,
                    description: `Contents of AWS::S3::Bucket '${customResourceProperties.DestinationBucketName}'`,
                    metadata: evaluateCfnTemplate.metadataFor(logicalId),
                }],
        },
        hotswappable: true,
        service: 'custom-s3-deployment',
        apply: async (sdk) => {
            await sdk.lambda().invokeCommand({
                FunctionName: functionName,
                // Lambda refuses to take a direct JSON object and requires it to be stringify()'d
                Payload: JSON.stringify({
                    RequestType: 'Update',
                    ResponseURL: REQUIRED_BY_CFN,
                    PhysicalResourceId: REQUIRED_BY_CFN,
                    StackId: REQUIRED_BY_CFN,
                    RequestId: REQUIRED_BY_CFN,
                    LogicalResourceId: REQUIRED_BY_CFN,
                    ResourceProperties: stringifyObject(customResourceProperties), // JSON.stringify() doesn't turn the actual objects to strings, but the lambda expects strings
                }),
            });
        },
    });
    return ret;
}
async function skipChangeForS3DeployCustomResourcePolicy(iamPolicyLogicalId, change, evaluateCfnTemplate) {
    if (change.newValue.Type !== 'AWS::IAM::Policy') {
        return false;
    }
    const roles = change.newValue.Properties?.Roles;
    // If no roles are referenced, the policy is definitely not used for a S3Deployment
    if (!roles || !roles.length) {
        return false;
    }
    // Check if every role this policy is referenced by is only used for a S3Deployment
    for (const role of roles) {
        const roleArn = await evaluateCfnTemplate.evaluateCfnExpression(role);
        const roleLogicalId = await evaluateCfnTemplate.findLogicalIdForPhysicalName(roleArn);
        // We must assume this role is used for something else, because we can't check it
        if (!roleLogicalId) {
            return false;
        }
        // Find all interesting reference to the role
        const roleRefs = evaluateCfnTemplate
            .findReferencesTo(roleLogicalId)
            // we are not interested in the reference from the original policy - it always exists
            .filter((roleRef) => !(roleRef.Type == 'AWS::IAM::Policy' && roleRef.LogicalId === iamPolicyLogicalId));
        // Check if the role is only used for S3Deployment
        // We know this is the case, if S3Deployment -> Lambda -> Role is satisfied for every reference
        // And we have at least one reference.
        const isRoleOnlyForS3Deployment = roleRefs.length >= 1 &&
            roleRefs.every((roleRef) => {
                if (roleRef.Type === 'AWS::Lambda::Function') {
                    const lambdaRefs = evaluateCfnTemplate.findReferencesTo(roleRef.LogicalId);
                    // Every reference must be to the custom resource and at least one reference must be present
                    return (lambdaRefs.length >= 1 && lambdaRefs.every((lambdaRef) => lambdaRef.Type === 'Custom::CDKBucketDeployment'));
                }
                return false;
            });
        // We have determined this role is used for something else, so we can't skip the change
        if (!isRoleOnlyForS3Deployment) {
            return false;
        }
    }
    // We have checked that any use of this policy is only for S3Deployment and we can safely skip it
    return true;
}
function stringifyObject(obj) {
    if (obj == null) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(stringifyObject);
    }
    if (typeof obj !== 'object') {
        return obj.toString();
    }
    const ret = {};
    for (const [k, v] of Object.entries(obj)) {
        ret[k] = stringifyObject(v);
    }
    return ret;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiczMtYnVja2V0LWRlcGxveW1lbnRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9ob3Rzd2FwL3MzLWJ1Y2tldC1kZXBsb3ltZW50cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWFBLHdGQXdEQztBQUVELDhGQXVEQztBQXpIRDs7O0dBR0c7QUFDSCxNQUFNLGVBQWUsR0FBRywrQkFBK0IsQ0FBQztBQUV4RCxNQUFNLDhCQUE4QixHQUFHLDZCQUE2QixDQUFDO0FBRTlELEtBQUssVUFBVSxzQ0FBc0MsQ0FDMUQsU0FBaUIsRUFDakIsTUFBc0IsRUFDdEIsbUJBQW1EO0lBRW5ELGtHQUFrRztJQUNsRyx1RkFBdUY7SUFDdkYsTUFBTSxHQUFHLEdBQW9CLEVBQUUsQ0FBQztJQUVoQyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLDhCQUE4QixFQUFFLENBQUM7UUFDNUQsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0lBRUQsdUdBQXVHO0lBQ3ZHLE1BQU0sd0JBQXdCLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQztRQUMvRSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsVUFBVTtRQUM3QixZQUFZLEVBQUUsU0FBUztLQUN4QixDQUFDLENBQUM7SUFFSCx3SEFBd0g7SUFDeEgsTUFBTSxZQUFZLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxZQUFZLENBQUMsQ0FBQztJQUMvRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDbEIsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBRUQsR0FBRyxDQUFDLElBQUksQ0FBQztRQUNQLE1BQU0sRUFBRTtZQUNOLEtBQUssRUFBRSxNQUFNO1lBQ2IsU0FBUyxFQUFFLENBQUM7b0JBQ1YsU0FBUztvQkFDVCxZQUFZLEVBQUUsd0JBQXdCLENBQUMscUJBQXFCO29CQUM1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T0FBTyxLQUFLLENBQUM7WUFDZixDQUFDLENBQUMsQ0FBQztRQUVMLHVGQUF1RjtRQUN2RixJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQztZQUMvQixPQUFPLEtBQUssQ0FBQztRQUNmLENBQUM7SUFDSCxDQUFDO0lBRUQsaUdBQWlHO0lBQ2pHLE9BQU8sSUFBSSxDQUFDO0FBQ2QsQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLEdBQVE7SUFDL0IsSUFBSSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7UUFDaEIsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBQ0QsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDdkIsT0FBTyxHQUFHLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDO0lBQ2xDLENBQUM7SUFDRCxJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQzVCLE9BQU8sR0FBRyxDQUFDLFFBQVEsRUFBRSxDQUFDO0lBQ3hCLENBQUM7SUFFRCxNQUFNLEdBQUcsR0FBeUIsRUFBRSxDQUFDO0lBQ3JDLEtBQUssTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDekMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUM5QixDQUFDO0lBQ0QsT0FBTyxHQUFHLENBQUM7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBIb3Rzd2FwQ2hhbmdlIH0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHR5cGUgeyBSZXNvdXJjZUNoYW5nZSB9IGZyb20gJy4uLy4uL3BheWxvYWRzL2hvdHN3YXAnO1xuaW1wb3J0IHR5cGUgeyBTREsgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgdHlwZSB7IEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZSB9IGZyb20gJy4uL2Nsb3VkZm9ybWF0aW9uJztcblxuLyoqXG4gKiBUaGlzIG1lYW5zIHRoYXQgdGhlIHZhbHVlIGlzIHJlcXVpcmVkIHRvIGV4aXN0IGJ5IENsb3VkRm9ybWF0aW9uJ3MgQ3VzdG9tIFJlc291cmNlIEFQSSAob3Igb3VyIFMzIEJ1Y2tldCBEZXBsb3ltZW50IExhbWJkYSdzIEFQSSlcbiAqIGJ1dCB0aGUgYWN0dWFsIHZhbHVlIHNwZWNpZmllZCBpcyBpcnJlbGV2YW50XG4gKi9cbmNvbnN0IFJFUVVJUkVEX0JZX0NGTiA9ICdyZXF1aXJlZC10by1iZS1wcmVzZW50LWJ5LWNmbic7XG5cbmNvbnN0IENES19CVUNLRVRfREVQTE9ZTUVOVF9DRk5fVFlQRSA9ICdDdXN0b206OkNES0J1Y2tldERlcGxveW1lbnQnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaXNIb3Rzd2FwcGFibGVTM0J1Y2tldERlcGxveW1lbnRDaGFuZ2UoXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IFJlc291cmNlQ2hhbmdlLFxuICBldmFsdWF0ZUNmblRlbXBsYXRlOiBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUsXG4pOiBQcm9taXNlPEhvdHN3YXBDaGFuZ2VbXT4ge1xuICAvLyBJbiBvbGQtc3R5bGUgc3ludGhlc2lzLCB0aGUgcG9saWN5IHVzZWQgYnkgdGhlIGxhbWJkYSB0byBjb3B5IGFzc2V0cyBSZWYncyB0aGUgYXNzZXRzIGRpcmVjdGx5LFxuICAvLyBtZWFuaW5nIHRoYXQgdGhlIGNoYW5nZXMgbWFkZSB0byB0aGUgUG9saWN5IGFyZSBhcnRpZmFjdHMgdGhhdCBjYW4gYmUgc2FmZWx5IGlnbm9yZWRcbiAgY29uc3QgcmV0OiBIb3Rzd2FwQ2hhbmdlW10gPSBbXTtcblxuICBpZiAoY2hhbmdlLm5ld1ZhbHVlLlR5cGUgIT09IENES19CVUNLRVRfREVQTE9ZTUVOVF9DRk5fVFlQRSkge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8vIG5vIGNsYXNzaWZpY2F0aW9uIHRvIGJlIGRvbmUgaGVyZTsgYWxsIHRoZSBwcm9wZXJ0aWVzIG9mIHRoaXMgY3VzdG9tIHJlc291cmNlIHRoaW5nIGFyZSBob3Rzd2FwcGFibGVcbiAgY29uc3QgY3VzdG9tUmVzb3VyY2VQcm9wZXJ0aWVzID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24oe1xuICAgIC4uLmNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzLFxuICAgIFNlcnZpY2VUb2tlbjogdW5kZWZpbmVkLFxuICB9KTtcblxuICAvLyBub3RlIHRoYXQgdGhpcyBnaXZlcyB0aGUgQVJOIG9mIHRoZSBsYW1iZGEsIG5vdCB0aGUgbmFtZS4gVGhpcyBpcyBmaW5lIHRob3VnaCwgdGhlIGludm9rZSgpIHNkayBjYWxsIHdpbGwgdGFrZSBlaXRoZXJcbiAgY29uc3QgZnVuY3Rpb25OYW1lID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24oY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LlNlcnZpY2VUb2tlbik7XG4gIGlmICghZnVuY3Rpb25OYW1lKSB7XG4gICAgcmV0dXJuIHJldDtcbiAgfVxuXG4gIHJldC5wdXNoKHtcbiAgICBjaGFuZ2U6IHtcbiAgICAgIGNhdXNlOiBjaGFuZ2UsXG4gICAgICByZXNvdXJjZXM6IFt7XG4gICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgcGh5c2ljYWxOYW1lOiBjdXN0b21SZXNvdXJjZVByb3BlcnRpZXMuRGVzdGluYXRpb25CdWNrZXROYW1lLFxuICAgICAgICByZXNvdXJjZVR5cGU6IENES19CVUNLRVRfREVQTE9ZTUVOVF9DRk5fVFlQRSxcbiAgICAgICAgZGVzY3JpcHRpb246IGBDb250ZW50cyBvZiBBV1M6OlMzOjpCdWNrZXQgJyR7Y3VzdG9tUmVzb3VyY2VQcm9wZXJ0aWVzLkRlc3RpbmF0aW9uQnVja2V0TmFtZX0nYCxcbiAgICAgICAgbWV0YWRhdGE6IGV2YWx1YXRlQ2ZuVGVtcGxhdGUubWV0YWRhdGFGb3IobG9naWNhbElkKSxcbiAgICAgIH1dLFxuICAgIH0sXG4gICAgaG90c3dhcHBhYmxlOiB0cnVlLFxuICAgIHNlcnZpY2U6ICdjdXN0b20tczMtZGVwbG95bWVudCcsXG4gICAgYXBwbHk6IGFzeW5jIChzZGs6IFNESykgPT4ge1xuICAgICAgYXdhaXQgc2RrLmxhbWJkYSgpLmludm9rZUNvbW1hbmQoe1xuICAgICAgICBGdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgLy8gTGFtYmRhIHJlZnVzZXMgdG8gdGFrZSBhIGRpcmVjdCBKU09OIG9iamVjdCBhbmQgcmVxdWlyZXMgaXQgdG8gYmUgc3RyaW5naWZ5KCknZFxuICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgUmVxdWVzdFR5cGU6ICdVcGRhdGUnLFxuICAgICAgICAgIFJlc3BvbnNlVVJMOiBSRVFVSVJFRF9CWV9DRk4sXG4gICAgICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiBSRVFVSVJFRF9CWV9DRk4sXG4gICAgICAgICAgU3RhY2tJZDogUkVRVUlSRURfQllfQ0ZOLFxuICAgICAgICAgIFJlcXVlc3RJZDogUkVRVUlSRURfQllfQ0ZOLFxuICAgICAgICAgIExvZ2ljYWxSZXNvdXJjZUlkOiBSRVFVSVJFRF9CWV9DRk4sXG4gICAgICAgICAgUmVzb3VyY2VQcm9wZXJ0aWVzOiBzdHJpbmdpZnlPYmplY3QoY3VzdG9tUmVzb3VyY2VQcm9wZXJ0aWVzKSwgLy8gSlNPTi5zdHJpbmdpZnkoKSBkb2Vzbid0IHR1cm4gdGhlIGFjdHVhbCBvYmplY3RzIHRvIHN0cmluZ3MsIGJ1dCB0aGUgbGFtYmRhIGV4cGVjdHMgc3RyaW5nc1xuICAgICAgICB9KSxcbiAgICAgIH0pO1xuICAgIH0sXG4gIH0pO1xuXG4gIHJldHVybiByZXQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBza2lwQ2hhbmdlRm9yUzNEZXBsb3lDdXN0b21SZXNvdXJjZVBvbGljeShcbiAgaWFtUG9saWN5TG9naWNhbElkOiBzdHJpbmcsXG4gIGNoYW5nZTogUmVzb3VyY2VDaGFuZ2UsXG4gIGV2YWx1YXRlQ2ZuVGVtcGxhdGU6IEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZSxcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoY2hhbmdlLm5ld1ZhbHVlLlR5cGUgIT09ICdBV1M6OklBTTo6UG9saWN5Jykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBjb25zdCByb2xlczogc3RyaW5nW10gPSBjaGFuZ2UubmV3VmFsdWUuUHJvcGVydGllcz8uUm9sZXM7XG5cbiAgLy8gSWYgbm8gcm9sZXMgYXJlIHJlZmVyZW5jZWQsIHRoZSBwb2xpY3kgaXMgZGVmaW5pdGVseSBub3QgdXNlZCBmb3IgYSBTM0RlcGxveW1lbnRcbiAgaWYgKCFyb2xlcyB8fCAhcm9sZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gQ2hlY2sgaWYgZXZlcnkgcm9sZSB0aGlzIHBvbGljeSBpcyByZWZlcmVuY2VkIGJ5IGlzIG9ubHkgdXNlZCBmb3IgYSBTM0RlcGxveW1lbnRcbiAgZm9yIChjb25zdCByb2xlIG9mIHJvbGVzKSB7XG4gICAgY29uc3Qgcm9sZUFybiA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKHJvbGUpO1xuICAgIGNvbnN0IHJvbGVMb2dpY2FsSWQgPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmZpbmRMb2dpY2FsSWRGb3JQaHlzaWNhbE5hbWUocm9sZUFybik7XG5cbiAgICAvLyBXZSBtdXN0IGFzc3VtZSB0aGlzIHJvbGUgaXMgdXNlZCBmb3Igc29tZXRoaW5nIGVsc2UsIGJlY2F1c2Ugd2UgY2FuJ3QgY2hlY2sgaXRcbiAgICBpZiAoIXJvbGVMb2dpY2FsSWQpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBGaW5kIGFsbCBpbnRlcmVzdGluZyByZWZlcmVuY2UgdG8gdGhlIHJvbGVcbiAgICBjb25zdCByb2xlUmVmcyA9IGV2YWx1YXRlQ2ZuVGVtcGxhdGVcbiAgICAgIC5maW5kUmVmZXJlbmNlc1RvKHJvbGVMb2dpY2FsSWQpXG4gICAgICAvLyB3ZSBhcmUgbm90IGludGVyZXN0ZWQgaW4gdGhlIHJlZmVyZW5jZSBmcm9tIHRoZSBvcmlnaW5hbCBwb2xpY3kgLSBpdCBhbHdheXMgZXhpc3RzXG4gICAgICAuZmlsdGVyKChyb2xlUmVmKSA9PiAhKHJvbGVSZWYuVHlwZSA9PSAnQVdTOjpJQU06OlBvbGljeScgJiYgcm9sZVJlZi5Mb2dpY2FsSWQgPT09IGlhbVBvbGljeUxvZ2ljYWxJZCkpO1xuXG4gICAgLy8gQ2hlY2sgaWYgdGhlIHJvbGUgaXMgb25seSB1c2VkIGZvciBTM0RlcGxveW1lbnRcbiAgICAvLyBXZSBrbm93IHRoaXMgaXMgdGhlIGNhc2UsIGlmIFMzRGVwbG95bWVudCAtPiBMYW1iZGEgLT4gUm9sZSBpcyBzYXRpc2ZpZWQgZm9yIGV2ZXJ5IHJlZmVyZW5jZVxuICAgIC8vIEFuZCB3ZSBoYXZlIGF0IGxlYXN0IG9uZSByZWZlcmVuY2UuXG4gICAgY29uc3QgaXNSb2xlT25seUZvclMzRGVwbG95bWVudCA9XG4gICAgICByb2xlUmVmcy5sZW5ndGggPj0gMSAmJlxuICAgICAgcm9sZVJlZnMuZXZlcnkoKHJvbGVSZWYpID0+IHtcbiAgICAgICAgaWYgKHJvbGVSZWYuVHlwZSA9PT0gJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicpIHtcbiAgICAgICAgICBjb25zdCBsYW1iZGFSZWZzID0gZXZhbHVhdGVDZm5UZW1wbGF0ZS5maW5kUmVmZXJlbmNlc1RvKHJvbGVSZWYuTG9naWNhbElkKTtcbiAgICAgICAgICAvLyBFdmVyeSByZWZlcmVuY2UgbXVzdCBiZSB0byB0aGUgY3VzdG9tIHJlc291cmNlIGFuZCBhdCBsZWFzdCBvbmUgcmVmZXJlbmNlIG11c3QgYmUgcHJlc2VudFxuICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICBsYW1iZGFSZWZzLmxlbmd0aCA+PSAxICYmIGxhbWJkYVJlZnMuZXZlcnkoKGxhbWJkYVJlZikgPT4gbGFtYmRhUmVmLlR5cGUgPT09ICdDdXN0b206OkNES0J1Y2tldERlcGxveW1lbnQnKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG5cbiAgICAvLyBXZSBoYXZlIGRldGVybWluZWQgdGhpcyByb2xlIGlzIHVzZWQgZm9yIHNvbWV0aGluZyBlbHNlLCBzbyB3ZSBjYW4ndCBza2lwIHRoZSBjaGFuZ2VcbiAgICBpZiAoIWlzUm9sZU9ubHlGb3JTM0RlcGxveW1lbnQpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyBXZSBoYXZlIGNoZWNrZWQgdGhhdCBhbnkgdXNlIG9mIHRoaXMgcG9saWN5IGlzIG9ubHkgZm9yIFMzRGVwbG95bWVudCBhbmQgd2UgY2FuIHNhZmVseSBza2lwIGl0XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBzdHJpbmdpZnlPYmplY3Qob2JqOiBhbnkpOiBhbnkge1xuICBpZiAob2JqID09IG51bGwpIHtcbiAgICByZXR1cm4gb2JqO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KG9iaikpIHtcbiAgICByZXR1cm4gb2JqLm1hcChzdHJpbmdpZnlPYmplY3QpO1xuICB9XG4gIGlmICh0eXBlb2Ygb2JqICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBvYmoudG9TdHJpbmcoKTtcbiAgfVxuXG4gIGNvbnN0IHJldDogeyBbazogc3RyaW5nXTogYW55IH0gPSB7fTtcbiAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMob2JqKSkge1xuICAgIHJldFtrXSA9IHN0cmluZ2lmeU9iamVjdCh2KTtcbiAgfVxuICByZXR1cm4gcmV0O1xufVxuIl19