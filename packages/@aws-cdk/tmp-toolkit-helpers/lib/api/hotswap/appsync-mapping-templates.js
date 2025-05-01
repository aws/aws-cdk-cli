"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHotswappableAppSyncChange = isHotswappableAppSyncChange;
const common_1 = require("./common");
const util_1 = require("../../util");
const toolkit_error_1 = require("../toolkit-error");
async function isHotswappableAppSyncChange(logicalId, change, evaluateCfnTemplate) {
    const isResolver = change.newValue.Type === 'AWS::AppSync::Resolver';
    const isFunction = change.newValue.Type === 'AWS::AppSync::FunctionConfiguration';
    const isGraphQLSchema = change.newValue.Type === 'AWS::AppSync::GraphQLSchema';
    const isAPIKey = change.newValue.Type === 'AWS::AppSync::ApiKey';
    if (!isResolver && !isFunction && !isGraphQLSchema && !isAPIKey) {
        return [];
    }
    const ret = [];
    const classifiedChanges = (0, common_1.classifyChanges)(change, [
        'RequestMappingTemplate',
        'RequestMappingTemplateS3Location',
        'ResponseMappingTemplate',
        'ResponseMappingTemplateS3Location',
        'Code',
        'CodeS3Location',
        'Definition',
        'DefinitionS3Location',
        'Expires',
    ]);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
    if (namesOfHotswappableChanges.length > 0) {
        let physicalName = undefined;
        const arn = await evaluateCfnTemplate.establishResourcePhysicalName(logicalId, isFunction ? change.newValue.Properties?.Name : undefined);
        if (isResolver) {
            const arnParts = arn?.split('/');
            physicalName = arnParts ? `${arnParts[3]}.${arnParts[5]}` : undefined;
        }
        else {
            physicalName = arn;
        }
        // nothing do here
        if (!physicalName) {
            return ret;
        }
        ret.push({
            change: {
                cause: change,
                resources: [{
                        logicalId,
                        resourceType: change.newValue.Type,
                        physicalName,
                        metadata: evaluateCfnTemplate.metadataFor(logicalId),
                    }],
            },
            hotswappable: true,
            service: 'appsync',
            apply: async (sdk) => {
                const sdkProperties = {
                    ...change.oldValue.Properties,
                    Definition: change.newValue.Properties?.Definition,
                    DefinitionS3Location: change.newValue.Properties?.DefinitionS3Location,
                    requestMappingTemplate: change.newValue.Properties?.RequestMappingTemplate,
                    requestMappingTemplateS3Location: change.newValue.Properties?.RequestMappingTemplateS3Location,
                    responseMappingTemplate: change.newValue.Properties?.ResponseMappingTemplate,
                    responseMappingTemplateS3Location: change.newValue.Properties?.ResponseMappingTemplateS3Location,
                    code: change.newValue.Properties?.Code,
                    codeS3Location: change.newValue.Properties?.CodeS3Location,
                    expires: change.newValue.Properties?.Expires,
                };
                const evaluatedResourceProperties = await evaluateCfnTemplate.evaluateCfnExpression(sdkProperties);
                const sdkRequestObject = (0, util_1.transformObjectKeys)(evaluatedResourceProperties, util_1.lowerCaseFirstCharacter);
                // resolve s3 location files as SDK doesn't take in s3 location but inline code
                if (sdkRequestObject.requestMappingTemplateS3Location) {
                    sdkRequestObject.requestMappingTemplate = await fetchFileFromS3(sdkRequestObject.requestMappingTemplateS3Location, sdk);
                    delete sdkRequestObject.requestMappingTemplateS3Location;
                }
                if (sdkRequestObject.responseMappingTemplateS3Location) {
                    sdkRequestObject.responseMappingTemplate = await fetchFileFromS3(sdkRequestObject.responseMappingTemplateS3Location, sdk);
                    delete sdkRequestObject.responseMappingTemplateS3Location;
                }
                if (sdkRequestObject.definitionS3Location) {
                    sdkRequestObject.definition = await fetchFileFromS3(sdkRequestObject.definitionS3Location, sdk);
                    delete sdkRequestObject.definitionS3Location;
                }
                if (sdkRequestObject.codeS3Location) {
                    sdkRequestObject.code = await fetchFileFromS3(sdkRequestObject.codeS3Location, sdk);
                    delete sdkRequestObject.codeS3Location;
                }
                if (isResolver) {
                    await sdk.appsync().updateResolver(sdkRequestObject);
                }
                else if (isFunction) {
                    // Function version is only applicable when using VTL and mapping templates
                    // Runtime only applicable when using code (JS mapping templates)
                    if (sdkRequestObject.code) {
                        delete sdkRequestObject.functionVersion;
                    }
                    else {
                        delete sdkRequestObject.runtime;
                    }
                    const functions = await sdk.appsync().listFunctions({ apiId: sdkRequestObject.apiId });
                    const { functionId } = functions.find((fn) => fn.name === physicalName) ?? {};
                    // Updating multiple functions at the same time or along with graphql schema results in `ConcurrentModificationException`
                    await exponentialBackOffRetry(() => sdk.appsync().updateFunction({
                        ...sdkRequestObject,
                        functionId: functionId,
                    }), 6, 1000, 'ConcurrentModificationException');
                }
                else if (isGraphQLSchema) {
                    let schemaCreationResponse = await sdk
                        .appsync()
                        .startSchemaCreation(sdkRequestObject);
                    while (schemaCreationResponse.status &&
                        ['PROCESSING', 'DELETING'].some((status) => status === schemaCreationResponse.status)) {
                        await sleep(1000); // poll every second
                        const getSchemaCreationStatusRequest = {
                            apiId: sdkRequestObject.apiId,
                        };
                        schemaCreationResponse = await sdk.appsync().getSchemaCreationStatus(getSchemaCreationStatusRequest);
                    }
                    if (schemaCreationResponse.status === 'FAILED') {
                        throw new toolkit_error_1.ToolkitError(schemaCreationResponse.details ?? 'Schema creation has failed.');
                    }
                }
                else {
                    // isApiKey
                    if (!sdkRequestObject.id) {
                        // ApiKeyId is optional in CFN but required in SDK. Grab the KeyId from physicalArn if not available as part of CFN template
                        const arnParts = physicalName?.split('/');
                        if (arnParts && arnParts.length === 4) {
                            sdkRequestObject.id = arnParts[3];
                        }
                    }
                    await sdk.appsync().updateApiKey(sdkRequestObject);
                }
            },
        });
    }
    return ret;
}
async function fetchFileFromS3(s3Url, sdk) {
    const s3PathParts = s3Url.split('/');
    const s3Bucket = s3PathParts[2]; // first two are "s3:" and "" due to s3://
    const s3Key = s3PathParts.splice(3).join('/'); // after removing first three we reconstruct the key
    return (await sdk.s3().getObject({ Bucket: s3Bucket, Key: s3Key })).Body?.transformToString();
}
async function exponentialBackOffRetry(fn, numOfRetries, backOff, errorCodeToRetry) {
    try {
        await fn();
    }
    catch (error) {
        if (error && error.name === errorCodeToRetry && numOfRetries > 0) {
            await sleep(backOff); // time to wait doubles everytime function fails, starts at 1 second
            await exponentialBackOffRetry(fn, numOfRetries - 1, backOff * 2, errorCodeToRetry);
        }
        else {
            throw error;
        }
    }
}
async function sleep(ms) {
    return new Promise((ok) => setTimeout(ok, ms));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwc3luYy1tYXBwaW5nLXRlbXBsYXRlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvaG90c3dhcC9hcHBzeW5jLW1hcHBpbmctdGVtcGxhdGVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZUEsa0VBNEpDO0FBdktELHFDQUdrQjtBQUVsQixxQ0FBMEU7QUFJMUUsb0RBQWdEO0FBRXpDLEtBQUssVUFBVSwyQkFBMkIsQ0FDL0MsU0FBaUIsRUFDakIsTUFBc0IsRUFDdEIsbUJBQW1EO0lBRW5ELE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLHdCQUF3QixDQUFDO0lBQ3JFLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLHFDQUFxQyxDQUFDO0lBQ2xGLE1BQU0sZUFBZSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLDZCQUE2QixDQUFDO0lBQy9FLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLHNCQUFzQixDQUFDO0lBQ2pFLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxlQUFlLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNoRSxPQUFPLEVBQUUsQ0FBQztJQUNaLENBQUM7SUFFRCxNQUFNLEdBQUcsR0FBb0IsRUFBRSxDQUFDO0lBRWhDLE1BQU0saUJBQWlCLEdBQUcsSUFBQSx3QkFBZSxFQUFDLE1BQU0sRUFBRTtRQUNoRCx3QkFBd0I7UUFDeEIsa0NBQWtDO1FBQ2xDLHlCQUF5QjtRQUN6QixtQ0FBbUM7UUFDbkMsTUFBTTtRQUNOLGdCQUFnQjtRQUNoQixZQUFZO1FBQ1osc0JBQXNCO1FBQ3RCLFNBQVM7S0FDVixDQUFDLENBQUM7SUFDSCxpQkFBaUIsQ0FBQyxvQ0FBb0MsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUU1RCxNQUFNLDBCQUEwQixHQUFH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LElBQUksQ0FBQztRQUNILE1BQU0sRUFBRSxFQUFFLENBQUM7SUFDYixDQUFDO0lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztRQUNwQixJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLGdCQUFnQixJQUFJLFlBQVksR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNqRSxNQUFNLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLG9FQUFvRTtZQUMxRixNQUFNLHVCQUF1QixDQUFDLEVBQUUsRUFBRSxZQUFZLEdBQUcsQ0FBQyxFQUFFLE9BQU8sR0FBRyxDQUFDLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUNyRixDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDO0FBRUQsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFVO0lBQzdCLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUNqRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUge1xuICBHZXRTY2hlbWFDcmVhdGlvblN0YXR1c0NvbW1hbmRPdXRwdXQsXG4gIEdldFNjaGVtYUNyZWF0aW9uU3RhdHVzQ29tbWFuZElucHV0LFxufSBmcm9tICdAYXdzLXNkay9jbGllbnQtYXBwc3luYyc7XG5pbXBvcnQge1xuICB0eXBlIEhvdHN3YXBDaGFuZ2UsXG4gIGNsYXNzaWZ5Q2hhbmdlcyxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHR5cGUgeyBSZXNvdXJjZUNoYW5nZSB9IGZyb20gJy4uLy4uL3BheWxvYWRzL2hvdHN3YXAnO1xuaW1wb3J0IHsgbG93ZXJDYXNlRmlyc3RDaGFyYWN0ZXIsIHRyYW5zZm9ybU9iamVjdEtleXMgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB0eXBlIHsgU0RLIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuXG5pbXBvcnQgdHlwZSB7IEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZSB9IGZyb20gJy4uL2Nsb3VkZm9ybWF0aW9uJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4uL3Rvb2xraXQtZXJyb3InO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaXNIb3Rzd2FwcGFibGVBcHBTeW5jQ2hhbmdlKFxuICBsb2dpY2FsSWQ6IHN0cmluZyxcbiAgY2hhbmdlOiBSZXNvdXJjZUNoYW5nZSxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuKTogUHJvbWlzZTxIb3Rzd2FwQ2hhbmdlW10+IHtcbiAgY29uc3QgaXNSZXNvbHZlciA9IGNoYW5nZS5uZXdWYWx1ZS5UeXBlID09PSAnQVdTOjpBcHBTeW5jOjpSZXNvbHZlcic7XG4gIGNvbnN0IGlzRnVuY3Rpb24gPSBjaGFuZ2UubmV3VmFsdWUuVHlwZSA9PT0gJ0FXUzo6QXBwU3luYzo6RnVuY3Rpb25Db25maWd1cmF0aW9uJztcbiAgY29uc3QgaXNHcmFwaFFMU2NoZW1hID0gY2hhbmdlLm5ld1ZhbHVlLlR5cGUgPT09ICdBV1M6OkFwcFN5bmM6OkdyYXBoUUxTY2hlbWEnO1xuICBjb25zdCBpc0FQSUtleSA9IGNoYW5nZS5uZXdWYWx1ZS5UeXBlID09PSAnQVdTOjpBcHBTeW5jOjpBcGlLZXknO1xuICBpZiAoIWlzUmVzb2x2ZXIgJiYgIWlzRnVuY3Rpb24gJiYgIWlzR3JhcGhRTFNjaGVtYSAmJiAhaXNBUElLZXkpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCByZXQ6IEhvdHN3YXBDaGFuZ2VbXSA9IFtdO1xuXG4gIGNvbnN0IGNsYXNzaWZpZWRDaGFuZ2VzID0gY2xhc3NpZnlDaGFuZ2VzKGNoYW5nZSwgW1xuICAgICdSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlJyxcbiAgICAnUmVxdWVzdE1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb24nLFxuICAgICdSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZScsXG4gICAgJ1Jlc3BvbnNlTWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbicsXG4gICAgJ0NvZGUnLFxuICAgICdDb2RlUzNMb2NhdGlvbicsXG4gICAgJ0RlZmluaXRpb24nLFxuICAgICdEZWZpbml0aW9uUzNMb2NhdGlvbicsXG4gICAgJ0V4cGlyZXMnLFxuICBdKTtcbiAgY2xhc3NpZmllZENoYW5nZXMucmVwb3J0Tm9uSG90c3dhcHBhYmxlUHJvcGVydHlDaGFuZ2VzKHJldCk7XG5cbiAgY29uc3QgbmFtZXNPZkhvdHN3YXBwYWJsZUNoYW5nZXMgPSBPYmplY3Qua2V5cyhjbGFzc2lmaWVkQ2hhbmdlcy5ob3Rzd2FwcGFibGVQcm9wcyk7XG4gIGlmIChuYW1lc09mSG90c3dhcHBhYmxlQ2hhbmdlcy5sZW5ndGggPiAwKSB7XG4gICAgbGV0IHBoeXNpY2FsTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGFybiA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXN0YWJsaXNoUmVzb3VyY2VQaHlzaWNhbE5hbWUoXG4gICAgICBsb2dpY2FsSWQsXG4gICAgICBpc0Z1bmN0aW9uID8gY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/Lk5hbWUgOiB1bmRlZmluZWQsXG4gICAgKTtcbiAgICBpZiAoaXNSZXNvbHZlcikge1xuICAgICAgY29uc3QgYXJuUGFydHMgPSBhcm4/LnNwbGl0KCcvJyk7XG4gICAgICBwaHlzaWNhbE5hbWUgPSBhcm5QYXJ0cyA/IGAke2FyblBhcnRzWzNdfS4ke2FyblBhcnRzWzVdfWAgOiB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBoeXNpY2FsTmFtZSA9IGFybjtcbiAgICB9XG5cbiAgICAvLyBub3RoaW5nIGRvIGhlcmVcbiAgICBpZiAoIXBoeXNpY2FsTmFtZSkge1xuICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG5cbiAgICByZXQucHVzaCh7XG4gICAgICBjaGFuZ2U6IHtcbiAgICAgICAgY2F1c2U6IGNoYW5nZSxcbiAgICAgICAgcmVzb3VyY2VzOiBbe1xuICAgICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgICByZXNvdXJjZVR5cGU6IGNoYW5nZS5uZXdWYWx1ZS5UeXBlLFxuICAgICAgICAgIHBoeXNpY2FsTmFtZSxcbiAgICAgICAgICBtZXRhZGF0YTogZXZhbHVhdGVDZm5UZW1wbGF0ZS5tZXRhZGF0YUZvcihsb2dpY2FsSWQpLFxuICAgICAgICB9XSxcbiAgICAgIH0sXG4gICAgICBob3Rzd2FwcGFibGU6IHRydWUsXG4gICAgICBzZXJ2aWNlOiAnYXBwc3luYycsXG4gICAgICBhcHBseTogYXN5bmMgKHNkazogU0RLKSA9PiB7XG4gICAgICAgIGNvbnN0IHNka1Byb3BlcnRpZXM6IHsgW25hbWU6IHN0cmluZ106IGFueSB9ID0ge1xuICAgICAgICAgIC4uLmNoYW5nZS5vbGRWYWx1ZS5Qcm9wZXJ0aWVzLFxuICAgICAgICAgIERlZmluaXRpb246IGNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzPy5EZWZpbml0aW9uLFxuICAgICAgICAgIERlZmluaXRpb25TM0xvY2F0aW9uOiBjaGFuZ2UubmV3VmFsdWUuUHJvcGVydGllcz8uRGVmaW5pdGlvblMzTG9jYXRpb24sXG4gICAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LlJlcXVlc3RNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb246IGNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzPy5SZXF1ZXN0TWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbixcbiAgICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LlJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbjogY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LlJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbixcbiAgICAgICAgICBjb2RlOiBjaGFuZ2UubmV3VmFsdWUuUHJvcGVydGllcz8uQ29kZSxcbiAgICAgICAgICBjb2RlUzNMb2NhdGlvbjogY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LkNvZGVTM0xvY2F0aW9uLFxuICAgICAgICAgIGV4cGlyZXM6IGNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzPy5FeHBpcmVzLFxuICAgICAgICB9O1xuICAgICAgICBjb25zdCBldmFsdWF0ZWRSZXNvdXJjZVByb3BlcnRpZXMgPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbihzZGtQcm9wZXJ0aWVzKTtcbiAgICAgICAgY29uc3Qgc2RrUmVxdWVzdE9iamVjdCA9IHRyYW5zZm9ybU9iamVjdEtleXMoZXZhbHVhdGVkUmVzb3VyY2VQcm9wZXJ0aWVzLCBsb3dlckNhc2VGaXJzdENoYXJhY3Rlcik7XG5cbiAgICAgICAgLy8gcmVzb2x2ZSBzMyBsb2NhdGlvbiBmaWxlcyBhcyBTREsgZG9lc24ndCB0YWtlIGluIHMzIGxvY2F0aW9uIGJ1dCBpbmxpbmUgY29kZVxuICAgICAgICBpZiAoc2RrUmVxdWVzdE9iamVjdC5yZXF1ZXN0TWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbikge1xuICAgICAgICAgIHNka1JlcXVlc3RPYmplY3QucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSA9IGF3YWl0IGZldGNoRmlsZUZyb21TMyhcbiAgICAgICAgICAgIHNka1JlcXVlc3RPYmplY3QucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb24sXG4gICAgICAgICAgICBzZGssXG4gICAgICAgICAgKTtcbiAgICAgICAgICBkZWxldGUgc2RrUmVxdWVzdE9iamVjdC5yZXF1ZXN0TWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2RrUmVxdWVzdE9iamVjdC5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb24pIHtcbiAgICAgICAgICBzZGtSZXF1ZXN0T2JqZWN0LnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlID0gYXdhaXQgZmV0Y2hGaWxlRnJvbVMzKFxuICAgICAgICAgICAgc2RrUmVxdWVzdE9iamVjdC5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb24sXG4gICAgICAgICAgICBzZGssXG4gICAgICAgICAgKTtcbiAgICAgICAgICBkZWxldGUgc2RrUmVxdWVzdE9iamVjdC5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb247XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNka1JlcXVlc3RPYmplY3QuZGVmaW5pdGlvblMzTG9jYXRpb24pIHtcbiAgICAgICAgICBzZGtSZXF1ZXN0T2JqZWN0LmRlZmluaXRpb24gPSBhd2FpdCBmZXRjaEZpbGVGcm9tUzMoc2RrUmVxdWVzdE9iamVjdC5kZWZpbml0aW9uUzNMb2NhdGlvbiwgc2RrKTtcbiAgICAgICAgICBkZWxldGUgc2RrUmVxdWVzdE9iamVjdC5kZWZpbml0aW9uUzNMb2NhdGlvbjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2RrUmVxdWVzdE9iamVjdC5jb2RlUzNMb2NhdGlvbikge1xuICAgICAgICAgIHNka1JlcXVlc3RPYmplY3QuY29kZSA9IGF3YWl0IGZldGNoRmlsZUZyb21TMyhzZGtSZXF1ZXN0T2JqZWN0LmNvZGVTM0xvY2F0aW9uLCBzZGspO1xuICAgICAgICAgIGRlbGV0ZSBzZGtSZXF1ZXN0T2JqZWN0LmNvZGVTM0xvY2F0aW9uO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzUmVzb2x2ZXIpIHtcbiAgICAgICAgICBhd2FpdCBzZGsuYXBwc3luYygpLnVwZGF0ZVJlc29sdmVyKHNka1JlcXVlc3RPYmplY3QpO1xuICAgICAgICB9IGVsc2UgaWYgKGlzRnVuY3Rpb24pIHtcbiAgICAgICAgICAvLyBGdW5jdGlvbiB2ZXJzaW9uIGlzIG9ubHkgYXBwbGljYWJsZSB3aGVuIHVzaW5nIFZUTCBhbmQgbWFwcGluZyB0ZW1wbGF0ZXNcbiAgICAgICAgICAvLyBSdW50aW1lIG9ubHkgYXBwbGljYWJsZSB3aGVuIHVzaW5nIGNvZGUgKEpTIG1hcHBpbmcgdGVtcGxhdGVzKVxuICAgICAgICAgIGlmIChzZGtSZXF1ZXN0T2JqZWN0LmNvZGUpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBzZGtSZXF1ZXN0T2JqZWN0LmZ1bmN0aW9uVmVyc2lvbjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVsZXRlIHNka1JlcXVlc3RPYmplY3QucnVudGltZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBmdW5jdGlvbnMgPSBhd2FpdCBzZGsuYXBwc3luYygpLmxpc3RGdW5jdGlvbnMoeyBhcGlJZDogc2RrUmVxdWVzdE9iamVjdC5hcGlJZCB9KTtcbiAgICAgICAgICBjb25zdCB7IGZ1bmN0aW9uSWQgfSA9IGZ1bmN0aW9ucy5maW5kKChmbikgPT4gZm4ubmFtZSA9PT0gcGh5c2ljYWxOYW1lKSA/PyB7fTtcbiAgICAgICAgICAvLyBVcGRhdGluZyBtdWx0aXBsZSBmdW5jdGlvbnMgYXQgdGhlIHNhbWUgdGltZSBvciBhbG9uZyB3aXRoIGdyYXBocWwgc2NoZW1hIHJlc3VsdHMgaW4gYENvbmN1cnJlbnRNb2RpZmljYXRpb25FeGNlcHRpb25gXG4gICAgICAgICAgYXdhaXQgZXhwb25lbnRpYWxCYWNrT2ZmUmV0cnkoXG4gICAgICAgICAgICAoKSA9PlxuICAgICAgICAgICAgICBzZGsuYXBwc3luYygpLnVwZGF0ZUZ1bmN0aW9uKHtcbiAgICAgICAgICAgICAgICAuLi5zZGtSZXF1ZXN0T2JqZWN0LFxuICAgICAgICAgICAgICAgIGZ1bmN0aW9uSWQ6IGZ1bmN0aW9uSWQsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgNixcbiAgICAgICAgICAgIDEwMDAsXG4gICAgICAgICAgICAnQ29uY3VycmVudE1vZGlmaWNhdGlvbkV4Y2VwdGlvbicsXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChpc0dyYXBoUUxTY2hlbWEpIHtcbiAgICAgICAgICBsZXQgc2NoZW1hQ3JlYXRpb25SZXNwb25zZTogR2V0U2NoZW1hQ3JlYXRpb25TdGF0dXNDb21tYW5kT3V0cHV0ID0gYXdhaXQgc2RrXG4gICAgICAgICAgICAuYXBwc3luYygpXG4gICAgICAgICAgICAuc3RhcnRTY2hlbWFDcmVhdGlvbihzZGtSZXF1ZXN0T2JqZWN0KTtcbiAgICAgICAgICB3aGlsZSAoXG4gICAgICAgICAgICBzY2hlbWFDcmVhdGlvblJlc3BvbnNlLnN0YXR1cyAmJlxuICAgICAgICAgICAgWydQUk9DRVNTSU5HJywgJ0RFTEVUSU5HJ10uc29tZSgoc3RhdHVzKSA9PiBzdGF0dXMgPT09IHNjaGVtYUNyZWF0aW9uUmVzcG9uc2Uuc3RhdHVzKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgYXdhaXQgc2xlZXAoMTAwMCk7IC8vIHBvbGwgZXZlcnkgc2Vjb25kXG4gICAgICAgICAgICBjb25zdCBnZXRTY2hlbWFDcmVhdGlvblN0YXR1c1JlcXVlc3Q6IEdldFNjaGVtYUNyZWF0aW9uU3RhdHVzQ29tbWFuZElucHV0ID0ge1xuICAgICAgICAgICAgICBhcGlJZDogc2RrUmVxdWVzdE9iamVjdC5hcGlJZCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBzY2hlbWFDcmVhdGlvblJlc3BvbnNlID0gYXdhaXQgc2RrLmFwcHN5bmMoKS5nZXRTY2hlbWFDcmVhdGlvblN0YXR1cyhnZXRTY2hlbWFDcmVhdGlvblN0YXR1c1JlcXVlc3QpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc2NoZW1hQ3JlYXRpb25SZXNwb25zZS5zdGF0dXMgPT09ICdGQUlMRUQnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKHNjaGVtYUNyZWF0aW9uUmVzcG9uc2UuZGV0YWlscyA/PyAnU2NoZW1hIGNyZWF0aW9uIGhhcyBmYWlsZWQuJyk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGlzQXBpS2V5XG4gICAgICAgICAgaWYgKCFzZGtSZXF1ZXN0T2JqZWN0LmlkKSB7XG4gICAgICAgICAgICAvLyBBcGlLZXlJZCBpcyBvcHRpb25hbCBpbiBDRk4gYnV0IHJlcXVpcmVkIGluIFNESy4gR3JhYiB0aGUgS2V5SWQgZnJvbSBwaHlzaWNhbEFybiBpZiBub3QgYXZhaWxhYmxlIGFzIHBhcnQgb2YgQ0ZOIHRlbXBsYXRlXG4gICAgICAgICAgICBjb25zdCBhcm5QYXJ0cyA9IHBoeXNpY2FsTmFtZT8uc3BsaXQoJy8nKTtcbiAgICAgICAgICAgIGlmIChhcm5QYXJ0cyAmJiBhcm5QYXJ0cy5sZW5ndGggPT09IDQpIHtcbiAgICAgICAgICAgICAgc2RrUmVxdWVzdE9iamVjdC5pZCA9IGFyblBhcnRzWzNdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBzZGsuYXBwc3luYygpLnVwZGF0ZUFwaUtleShzZGtSZXF1ZXN0T2JqZWN0KTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoRmlsZUZyb21TMyhzM1VybDogc3RyaW5nLCBzZGs6IFNESykge1xuICBjb25zdCBzM1BhdGhQYXJ0cyA9IHMzVXJsLnNwbGl0KCcvJyk7XG4gIGNvbnN0IHMzQnVja2V0ID0gczNQYXRoUGFydHNbMl07IC8vIGZpcnN0IHR3byBhcmUgXCJzMzpcIiBhbmQgXCJcIiBkdWUgdG8gczM6Ly9cbiAgY29uc3QgczNLZXkgPSBzM1BhdGhQYXJ0cy5zcGxpY2UoMykuam9pbignLycpOyAvLyBhZnRlciByZW1vdmluZyBmaXJzdCB0aHJlZSB3ZSByZWNvbnN0cnVjdCB0aGUga2V5XG4gIHJldHVybiAoYXdhaXQgc2RrLnMzKCkuZ2V0T2JqZWN0KHsgQnVja2V0OiBzM0J1Y2tldCwgS2V5OiBzM0tleSB9KSkuQm9keT8udHJhbnNmb3JtVG9TdHJpbmcoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwb25lbnRpYWxCYWNrT2ZmUmV0cnkoZm46ICgpID0+IFByb21pc2U8YW55PiwgbnVtT2ZSZXRyaWVzOiBudW1iZXIsIGJhY2tPZmY6IG51bWJlciwgZXJyb3JDb2RlVG9SZXRyeTogc3RyaW5nKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgZm4oKTtcbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGlmIChlcnJvciAmJiBlcnJvci5uYW1lID09PSBlcnJvckNvZGVUb1JldHJ5ICYmIG51bU9mUmV0cmllcyA+IDApIHtcbiAgICAgIGF3YWl0IHNsZWVwKGJhY2tPZmYpOyAvLyB0aW1lIHRvIHdhaXQgZG91YmxlcyBldmVyeXRpbWUgZnVuY3Rpb24gZmFpbHMsIHN0YXJ0cyBhdCAxIHNlY29uZFxuICAgICAgYXdhaXQgZXhwb25lbnRpYWxCYWNrT2ZmUmV0cnkoZm4sIG51bU9mUmV0cmllcyAtIDEsIGJhY2tPZmYgKiAyLCBlcnJvckNvZGVUb1JldHJ5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNsZWVwKG1zOiBudW1iZXIpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChvaykgPT4gc2V0VGltZW91dChvaywgbXMpKTtcbn1cbiJdfQ==