"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHotswappableEcsServiceChange = isHotswappableEcsServiceChange;
const common_1 = require("./common");
const hotswap_1 = require("../../payloads/hotswap");
const util_1 = require("../../util");
const ECS_SERVICE_RESOURCE_TYPE = 'AWS::ECS::Service';
async function isHotswappableEcsServiceChange(logicalId, change, evaluateCfnTemplate, hotswapPropertyOverrides) {
    // the only resource change we can evaluate here is an ECS TaskDefinition
    if (change.newValue.Type !== 'AWS::ECS::TaskDefinition') {
        return [];
    }
    const ret = [];
    // We only allow a change in the ContainerDefinitions of the TaskDefinition for now -
    // it contains the image and environment variables, so seems like a safe bet for now.
    // We might revisit this decision in the future though!
    const classifiedChanges = (0, common_1.classifyChanges)(change, ['ContainerDefinitions']);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    // find all ECS Services that reference the TaskDefinition that changed
    const resourcesReferencingTaskDef = evaluateCfnTemplate.findReferencesTo(logicalId);
    const ecsServiceResourcesReferencingTaskDef = resourcesReferencingTaskDef.filter((r) => r.Type === ECS_SERVICE_RESOURCE_TYPE);
    const ecsServicesReferencingTaskDef = new Array();
    for (const ecsServiceResource of ecsServiceResourcesReferencingTaskDef) {
        const serviceArn = await evaluateCfnTemplate.findPhysicalNameFor(ecsServiceResource.LogicalId);
        if (serviceArn) {
            ecsServicesReferencingTaskDef.push({
                logicalId: ecsServiceResource.LogicalId,
                serviceArn,
            });
        }
    }
    if (ecsServicesReferencingTaskDef.length === 0) {
        /**
         * ECS Services can have a task definition that doesn't refer to the task definition being updated.
         * We have to log this as a non-hotswappable change to the task definition, but when we do,
         * we wind up hotswapping the task definition and logging it as a non-hotswappable change.
         *
         * This logic prevents us from logging that change as non-hotswappable when we hotswap it.
         */
        ret.push((0, common_1.nonHotswappableChange)(change, hotswap_1.NonHotswappableReason.DEPENDENCY_UNSUPPORTED, 'No ECS services reference the changed task definition', undefined, false));
    }
    if (resourcesReferencingTaskDef.length > ecsServicesReferencingTaskDef.length) {
        // if something besides an ECS Service is referencing the TaskDefinition,
        // hotswap is not possible in FALL_BACK mode
        const nonEcsServiceTaskDefRefs = resourcesReferencingTaskDef.filter((r) => r.Type !== ECS_SERVICE_RESOURCE_TYPE);
        for (const taskRef of nonEcsServiceTaskDefRefs) {
            ret.push((0, common_1.nonHotswappableChange)(change, hotswap_1.NonHotswappableReason.DEPENDENCY_UNSUPPORTED, `A resource '${taskRef.LogicalId}' with Type '${taskRef.Type}' that is not an ECS Service was found referencing the changed TaskDefinition '${logicalId}'`));
        }
    }
    const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
    if (namesOfHotswappableChanges.length > 0) {
        const taskDefinitionResource = await prepareTaskDefinitionChange(evaluateCfnTemplate, logicalId, change);
        ret.push({
            change: {
                cause: change,
                resources: [
                    {
                        logicalId,
                        resourceType: change.newValue.Type,
                        physicalName: await taskDefinitionResource.Family,
                        metadata: evaluateCfnTemplate.metadataFor(logicalId),
                    },
                    ...ecsServicesReferencingTaskDef.map((ecsService) => ({
                        resourceType: ECS_SERVICE_RESOURCE_TYPE,
                        physicalName: ecsService.serviceArn.split('/')[2],
                        logicalId: ecsService.logicalId,
                        metadata: evaluateCfnTemplate.metadataFor(ecsService.logicalId),
                    })),
                ],
            },
            hotswappable: true,
            service: 'ecs-service',
            apply: async (sdk) => {
                // Step 1 - update the changed TaskDefinition, creating a new TaskDefinition Revision
                // we need to lowercase the evaluated TaskDef from CloudFormation,
                // as the AWS SDK uses lowercase property names for these
                // The SDK requires more properties here than its worth doing explicit typing for
                // instead, just use all the old values in the diff to fill them in implicitly
                const lowercasedTaskDef = (0, util_1.transformObjectKeys)(taskDefinitionResource, util_1.lowerCaseFirstCharacter, {
                    // All the properties that take arbitrary string as keys i.e. { "string" : "string" }
                    // https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RegisterTaskDefinition.html#API_RegisterTaskDefinition_RequestSyntax
                    ContainerDefinitions: {
                        DockerLabels: true,
                        FirelensConfiguration: {
                            Options: true,
                        },
                        LogConfiguration: {
                            Options: true,
                        },
                    },
                    Volumes: {
                        DockerVolumeConfiguration: {
                            DriverOpts: true,
                            Labels: true,
                        },
                    },
                });
                const registerTaskDefResponse = await sdk.ecs().registerTaskDefinition(lowercasedTaskDef);
                const taskDefRevArn = registerTaskDefResponse.taskDefinition?.taskDefinitionArn;
                let ecsHotswapProperties = hotswapPropertyOverrides.ecsHotswapProperties;
                let minimumHealthyPercent = ecsHotswapProperties?.minimumHealthyPercent;
                let maximumHealthyPercent = ecsHotswapProperties?.maximumHealthyPercent;
                // Step 2 - update the services using that TaskDefinition to point to the new TaskDefinition Revision
                // Forcing New Deployment and setting Minimum Healthy Percent to 0.
                // As CDK HotSwap is development only, this seems the most efficient way to ensure all tasks are replaced immediately, regardless of original amount
                // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
                await Promise.all(ecsServicesReferencingTaskDef.map(async (service) => {
                    const cluster = service.serviceArn.split('/')[1];
                    const update = await sdk.ecs().updateService({
                        service: service.serviceArn,
                        taskDefinition: taskDefRevArn,
                        cluster,
                        forceNewDeployment: true,
                        deploymentConfiguration: {
                            minimumHealthyPercent: minimumHealthyPercent !== undefined ? minimumHealthyPercent : 0,
                            maximumPercent: maximumHealthyPercent !== undefined ? maximumHealthyPercent : undefined,
                        },
                    });
                    await sdk.ecs().waitUntilServicesStable({
                        cluster: update.service?.clusterArn,
                        services: [service.serviceArn],
                    });
                }));
            },
        });
    }
    return ret;
}
async function prepareTaskDefinitionChange(evaluateCfnTemplate, logicalId, change) {
    const taskDefinitionResource = {
        ...change.oldValue.Properties,
        ContainerDefinitions: change.newValue.Properties?.ContainerDefinitions,
    };
    // first, let's get the name of the family
    const familyNameOrArn = await evaluateCfnTemplate.establishResourcePhysicalName(logicalId, taskDefinitionResource?.Family);
    if (!familyNameOrArn) {
        // if the Family property has not been provided, and we can't find it in the current Stack,
        // this means hotswapping is not possible
        return;
    }
    // the physical name of the Task Definition in CloudFormation includes its current revision number at the end,
    // remove it if needed
    const familyNameOrArnParts = familyNameOrArn.split(':');
    const family = familyNameOrArnParts.length > 1
        ? // familyNameOrArn is actually an ARN, of the format 'arn:aws:ecs:region:account:task-definition/<family-name>:<revision-nr>'
            // so, take the 6th element, at index 5, and split it on '/'
            familyNameOrArnParts[5].split('/')[1]
        : // otherwise, familyNameOrArn is just the simple name evaluated from the CloudFormation template
            familyNameOrArn;
    // then, let's evaluate the body of the remainder of the TaskDef (without the Family property)
    return {
        ...(await evaluateCfnTemplate.evaluateCfnExpression({
            ...(taskDefinitionResource ?? {}),
            Family: undefined,
        })),
        Family: family,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLXNlcnZpY2VzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9ob3Rzd2FwL2Vjcy1zZXJ2aWNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWVBLHdFQW9KQztBQS9KRCxxQ0FHa0I7QUFDbEIsb0RBQW9GO0FBQ3BGLHFDQUEwRTtBQUkxRSxNQUFNLHlCQUF5QixHQUFHLG1CQUFtQixDQUFDO0FBRS9DLEtBQUssVUFBVSw4QkFBOEIsQ0FDbEQsU0FBaUIsRUFDakIsTUFBc0IsRUFDdEIsbUJBQW1ELEVBQ25ELHdCQUFrRDtJQUVsRCx5RUFBeUU7SUFDekUsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksS0FBSywwQkFBMEIsRUFBRSxDQUFDO1FBQ3hELE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVELE1BQU0sR0FBRyxHQUFvQixFQUFFLENBQUM7SUFFaEMscUZBQXFGO0lBQ3JGLHFGQUFxRjtJQUNyRix1REFBdUQ7SUFDdkQsTUFBTSxpQkFBaUIsR0FBRyxJQUFBLHdCQUFlLEVBQUMsTUFBTSxFQUFFLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDO0lBQzVFLGlCQUFpQixDQUFDLG9DQUFvQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRTVELHVFQUF1RTtJQUN2RSxNQUFNLDJCQUEyQixHQUFHLG1CQUFtQixDQUFDLGdCQUFnQixDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3BGLE1BQU0scUNBQXFDLEdBQUcsMkJBQTJCLENBQUMsTUFBTSxDQUM5RSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyx5QkFBeUIsQ0FDNUMsQ0FBQztJQUNGLE1BQU0sNkJBQTZCLEdBQUcsSUFBSSxLQUFLLEVBQWMsQ0FBQztJQUM5RCxLQUFLLE1BQU0sa0JBQWtCLElBQUkscUNBQXFDLEVBQUUsQ0FBQztRQUN2RSxNQUFNLFVBQVUsR0FBRyxNQUFNLG1CQUFtQixDQUFDLG1CQUFt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LENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDckMsQ0FBQyxDQUFDLGdHQUFnRztZQUNsRyxlQUFlLENBQUM7SUFDcEIsOEZBQThGO0lBQzlGLE9BQU87UUFDTCxHQUFHLENBQUMsTUFBTSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQztZQUNsRCxHQUFHLENBQUMsc0JBQXNCLElBQUksRUFBRSxDQUFDO1lBQ2pDLE1BQU0sRUFBRSxTQUFTO1NBQ2xCLENBQUMsQ0FBQztRQUNILE1BQU0sRUFBRSxNQUFNO0tBQ2YsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7XG4gIEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyxcbiAgSG90c3dhcENoYW5nZSxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHtcbiAgY2xhc3NpZnlDaGFuZ2VzLFxuICBub25Ib3Rzd2FwcGFibGVDaGFuZ2UsXG59IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IE5vbkhvdHN3YXBwYWJsZVJlYXNvbiwgdHlwZSBSZXNvdXJjZUNoYW5nZSB9IGZyb20gJy4uLy4uL3BheWxvYWRzL2hvdHN3YXAnO1xuaW1wb3J0IHsgbG93ZXJDYXNlRmlyc3RDaGFyYWN0ZXIsIHRyYW5zZm9ybU9iamVjdEtleXMgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB0eXBlIHsgU0RLIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHR5cGUgeyBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUgfSBmcm9tICcuLi9jbG91ZGZvcm1hdGlvbic7XG5cbmNvbnN0IEVDU19TRVJWSUNFX1JFU09VUkNFX1RZUEUgPSAnQVdTOjpFQ1M6OlNlcnZpY2UnO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaXNIb3Rzd2FwcGFibGVFY3NTZXJ2aWNlQ2hhbmdlKFxuICBsb2dpY2FsSWQ6IHN0cmluZyxcbiAgY2hhbmdlOiBSZXNvdXJjZUNoYW5nZSxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuICBob3Rzd2FwUHJvcGVydHlPdmVycmlkZXM6IEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyxcbik6IFByb21pc2U8SG90c3dhcENoYW5nZVtdPiB7XG4gIC8vIHRoZSBvbmx5IHJlc291cmNlIGNoYW5nZSB3ZSBjYW4gZXZhbHVhdGUgaGVyZSBpcyBhbiBFQ1MgVGFza0RlZmluaXRpb25cbiAgaWYgKGNoYW5nZS5uZXdWYWx1ZS5UeXBlICE9PSAnQVdTOjpFQ1M6OlRhc2tEZWZpbml0aW9uJykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IHJldDogSG90c3dhcENoYW5nZVtdID0gW107XG5cbiAgLy8gV2Ugb25seSBhbGxvdyBhIGNoYW5nZSBpbiB0aGUgQ29udGFpbmVyRGVmaW5pdGlvbnMgb2YgdGhlIFRhc2tEZWZpbml0aW9uIGZvciBub3cgLVxuICAvLyBpdCBjb250YWlucyB0aGUgaW1hZ2UgYW5kIGVudmlyb25tZW50IHZhcmlhYmxlcywgc28gc2VlbXMgbGlrZSBhIHNhZmUgYmV0IGZvciBub3cuXG4gIC8vIFdlIG1pZ2h0IHJldmlzaXQgdGhpcyBkZWNpc2lvbiBpbiB0aGUgZnV0dXJlIHRob3VnaCFcbiAgY29uc3QgY2xhc3NpZmllZENoYW5nZXMgPSBjbGFzc2lmeUNoYW5nZXMoY2hhbmdlLCBbJ0NvbnRhaW5lckRlZmluaXRpb25zJ10pO1xuICBjbGFzc2lmaWVkQ2hhbmdlcy5yZXBvcnROb25Ib3Rzd2FwcGFibGVQcm9wZXJ0eUNoYW5nZXMocmV0KTtcblxuICAvLyBmaW5kIGFsbCBFQ1MgU2VydmljZXMgdGhhdCByZWZlcmVuY2UgdGhlIFRhc2tEZWZpbml0aW9uIHRoYXQgY2hhbmdlZFxuICBjb25zdCByZXNvdXJjZXNSZWZlcmVuY2luZ1Rhc2tEZWYgPSBldmFsdWF0ZUNmblRlbXBsYXRlLmZpbmRSZWZlcmVuY2VzVG8obG9naWNhbElkKTtcbiAgY29uc3QgZWNzU2VydmljZVJlc291cmNlc1JlZmVyZW5jaW5nVGFza0RlZiA9IHJlc291cmNlc1JlZmVyZW5jaW5nVGFza0RlZi5maWx0ZXIoXG4gICAgKHIpID0+IHIuVHlwZSA9PT0gRUNTX1NFUlZJQ0VfUkVTT1VSQ0VfVFlQRSxcbiAgKTtcbiAgY29uc3QgZWNzU2VydmljZXNSZWZlcmVuY2luZ1Rhc2tEZWYgPSBuZXcgQXJyYXk8RWNzU2VydmljZT4oKTtcbiAgZm9yIChjb25zdCBlY3NTZXJ2aWNlUmVzb3VyY2Ugb2YgZWNzU2VydmljZVJlc291cmNlc1JlZmVyZW5jaW5nVGFza0RlZikge1xuICAgIGNvbnN0IHNlcnZpY2VBcm4gPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmZpbmRQaHlzaWNhbE5hbWVGb3IoZWNzU2VydmljZVJlc291cmNlLkxvZ2ljYWxJZCk7XG4gICAgaWYgKHNlcnZpY2VBcm4pIHtcbiAgICAgIGVjc1NlcnZpY2VzUmVmZXJlbmNpbmdUYXNrRGVmLnB1c2goe1xuICAgICAgICBsb2dpY2FsSWQ6IGVjc1NlcnZpY2VSZXNvdXJjZS5Mb2dpY2FsSWQsXG4gICAgICAgIHNlcnZpY2VBcm4sXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgaWYgKGVjc1NlcnZpY2VzUmVmZXJlbmNpbmdUYXNrRGVmLmxlbmd0aCA9PT0gMCkge1xuICAgIC8qKlxuICAgICAqIEVDUyBTZXJ2aWNlcyBjYW4gaGF2ZSBhIHRhc2sgZGVmaW5pdGlvbiB0aGF0IGRvZXNuJ3QgcmVmZXIgdG8gdGhlIHRhc2sgZGVmaW5pdGlvbiBiZWluZyB1cGRhdGVkLlxuICAgICAqIFdlIGhhdmUgdG8gbG9nIHRoaXMgYXMgYSBub24taG90c3dhcHBhYmxlIGNoYW5nZSB0byB0aGUgdGFzayBkZWZpbml0aW9uLCBidXQgd2hlbiB3ZSBkbyxcbiAgICAgKiB3ZSB3aW5kIHVwIGhvdHN3YXBwaW5nIHRoZSB0YXNrIGRlZmluaXRpb24gYW5kIGxvZ2dpbmcgaXQgYXMgYSBub24taG90c3dhcHBhYmxlIGNoYW5nZS5cbiAgICAgKlxuICAgICAqIFRoaXMgbG9naWMgcHJldmVudHMgdXMgZnJvbSBsb2dnaW5nIHRoYXQgY2hhbmdlIGFzIG5vbi1ob3Rzd2FwcGFibGUgd2hlbiB3ZSBob3Rzd2FwIGl0LlxuICAgICAqL1xuICAgIHJldC5wdXNoKG5vbkhvdHN3YXBwYWJsZUNoYW5nZShcbiAgICAgIGNoYW5nZSxcbiAgICAgIE5vbkhvdHN3YXBwYWJsZVJlYXNvbi5ERVBFTkRFTkNZX1VOU1VQUE9SVEVELFxuICAgICAgJ05vIEVDUyBzZXJ2aWNlcyByZWZlcmVuY2UgdGhlIGNoYW5nZWQgdGFzayBkZWZpbml0aW9uJyxcbiAgICAgIHVuZGVmaW5lZCxcbiAgICAgIGZhbHNlLFxuICAgICkpO1xuICB9XG4gIGlmIChyZXNvdXJjZXNSZWZlcmVuY2luZ1Rhc2tEZWYubGVuZ3RoID4gZWNzU2VydmljZXNSZWZlcmVuY2luZ1Rhc2tEZWYubGVuZ3RoKSB7XG4gICAgLy8gaWYgc29tZXRoaW5nIGJlc2lkZXMgYW4gRUNTIFNlcnZpY2UgaXMgcmVmZXJlbmNpbmcgdGhlIFRhc2tEZWZpbml0aW9uLFxuICAgIC8vIGhvdHN3YXAgaXMgbm90IHBvc3NpYmxlIGluIEZBTExfQkFDSyBtb2RlXG4gICAgY29uc3Qgbm9uRWNzU2VydmljZVRhc2tEZWZSZWZzID0gcmVzb3VyY2VzUmVmZXJlbmNpbmdUYXNrRGVmLmZpbHRlcigocikgPT4gci5UeXBlICE9PSBFQ1NfU0VSVklDRV9SRVNPVVJDRV9UWVBFKTtcbiAgICBmb3IgKGNvbnN0IHRhc2tSZWYgb2Ygbm9uRWNzU2VydmljZVRhc2tEZWZSZWZzKSB7XG4gICAgICByZXQucHVzaChub25Ib3Rzd2FwcGFibGVDaGFuZ2UoXG4gICAgICAgIGNoYW5nZSxcbiAgICAgICAgTm9uSG90c3dhcHBhYmxlUmVhc29uLkRFUEVOREVOQ1lfVU5TVVBQT1JURUQsXG4gICAgICAgIGBBIHJlc291cmNlICcke3Rhc2tSZWYuTG9naWNhbElkfScgd2l0aCBUeXBlICcke3Rhc2tSZWYuVHlwZX0nIHRoYXQgaXMgbm90IGFuIEVDUyBTZXJ2aWNlIHdhcyBmb3VuZCByZWZlcmVuY2luZyB0aGUgY2hhbmdlZCBUYXNrRGVmaW5pdGlvbiAnJHtsb2dpY2FsSWR9J2AsXG4gICAgICApKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBuYW1lc09mSG90c3dhcHBhYmxlQ2hhbmdlcyA9IE9iamVjdC5rZXlzKGNsYXNzaWZpZWRDaGFuZ2VzLmhvdHN3YXBwYWJsZVByb3BzKTtcbiAgaWYgKG5hbWVzT2ZIb3Rzd2FwcGFibGVDaGFuZ2VzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCB0YXNrRGVmaW5pdGlvblJlc291cmNlID0gYXdhaXQgcHJlcGFyZVRhc2tEZWZpbml0aW9uQ2hhbmdlKGV2YWx1YXRlQ2ZuVGVtcGxhdGUsIGxvZ2ljYWxJZCwgY2hhbmdlKTtcbiAgICByZXQucHVzaCh7XG4gICAgICBjaGFuZ2U6IHtcbiAgICAgICAgY2F1c2U6IGNoYW5nZSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbG9naWNhbElkLFxuICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiBjaGFuZ2UubmV3VmFsdWUuVHlwZSxcbiAgICAgICAgICAgIHBoeXNpY2FsTmFtZTogYXdhaXQgdGFza0RlZmluaXRpb25SZXNvdXJjZS5GYW1pbHksXG4gICAgICAgICAgICBtZXRhZGF0YTogZXZhbHVhdGVDZm5UZW1wbGF0ZS5tZXRhZGF0YUZvcihsb2dpY2FsSWQpLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgLi4uZWNzU2VydmljZXNSZWZlcmVuY2luZ1Rhc2tEZWYubWFwKChlY3NTZXJ2aWNlKSA9PiAoe1xuICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiBFQ1NfU0VSVklDRV9SRVNPVVJDRV9UWVBFLFxuICAgICAgICAgICAgcGh5c2ljYWxOYW1lOiBlY3NTZXJ2aWNlLnNlcnZpY2VBcm4uc3BsaXQoJy8nKVsyXSxcbiAgICAgICAgICAgIGxvZ2ljYWxJZDogZWNzU2VydmljZS5sb2dpY2FsSWQsXG4gICAgICAgICAgICBtZXRhZGF0YTogZXZhbHVhdGVDZm5UZW1wbGF0ZS5tZXRhZGF0YUZvcihlY3NTZXJ2aWNlLmxvZ2ljYWxJZCksXG4gICAgICAgICAgfSkpLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIGhvdHN3YXBwYWJsZTogdHJ1ZSxcbiAgICAgIHNlcnZpY2U6ICdlY3Mtc2VydmljZScsXG4gICAgICBhcHBseTogYXN5bmMgKHNkazogU0RLKSA9PiB7XG4gICAgICAgIC8vIFN0ZXAgMSAtIHVwZGF0ZSB0aGUgY2hhbmdlZCBUYXNrRGVmaW5pdGlvbiwgY3JlYXRpbmcgYSBuZXcgVGFza0RlZmluaXRpb24gUmV2aXNpb25cbiAgICAgICAgLy8gd2UgbmVlZCB0byBsb3dlcmNhc2UgdGhlIGV2YWx1YXRlZCBUYXNrRGVmIGZyb20gQ2xvdWRGb3JtYXRpb24sXG4gICAgICAgIC8vIGFzIHRoZSBBV1MgU0RLIHVzZXMgbG93ZXJjYXNlIHByb3BlcnR5IG5hbWVzIGZvciB0aGVzZVxuXG4gICAgICAgIC8vIFRoZSBTREsgcmVxdWlyZXMgbW9yZSBwcm9wZXJ0aWVzIGhlcmUgdGhhbiBpdHMgd29ydGggZG9pbmcgZXhwbGljaXQgdHlwaW5nIGZvclxuICAgICAgICAvLyBpbnN0ZWFkLCBqdXN0IHVzZSBhbGwgdGhlIG9sZCB2YWx1ZXMgaW4gdGhlIGRpZmYgdG8gZmlsbCB0aGVtIGluIGltcGxpY2l0bHlcbiAgICAgICAgY29uc3QgbG93ZXJjYXNlZFRhc2tEZWYgPSB0cmFuc2Zvcm1PYmplY3RLZXlzKHRhc2tEZWZpbml0aW9uUmVzb3VyY2UsIGxvd2VyQ2FzZUZpcnN0Q2hhcmFjdGVyLCB7XG4gICAgICAgICAgLy8gQWxsIHRoZSBwcm9wZXJ0aWVzIHRoYXQgdGFrZSBhcmJpdHJhcnkgc3RyaW5nIGFzIGtleXMgaS5lLiB7IFwic3RyaW5nXCIgOiBcInN0cmluZ1wiIH1cbiAgICAgICAgICAvLyBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQW1hem9uRUNTL2xhdGVzdC9BUElSZWZlcmVuY2UvQVBJX1JlZ2lzdGVyVGFza0RlZmluaXRpb24uaHRtbCNBUElfUmVnaXN0ZXJUYXNrRGVmaW5pdGlvbl9SZXF1ZXN0U3ludGF4XG4gICAgICAgICAgQ29udGFpbmVyRGVmaW5pdGlvbnM6IHtcbiAgICAgICAgICAgIERvY2tlckxhYmVsczogdHJ1ZSxcbiAgICAgICAgICAgIEZpcmVsZW5zQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgICBPcHRpb25zOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIExvZ0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgICAgT3B0aW9uczogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBWb2x1bWVzOiB7XG4gICAgICAgICAgICBEb2NrZXJWb2x1bWVDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgIERyaXZlck9wdHM6IHRydWUsXG4gICAgICAgICAgICAgIExhYmVsczogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHJlZ2lzdGVyVGFza0RlZlJlc3BvbnNlID0gYXdhaXQgc2RrLmVjcygpLnJlZ2lzdGVyVGFza0RlZmluaXRpb24obG93ZXJjYXNlZFRhc2tEZWYpO1xuICAgICAgICBjb25zdCB0YXNrRGVmUmV2QXJuID0gcmVnaXN0ZXJUYXNrRGVmUmVzcG9uc2UudGFza0RlZmluaXRpb24/LnRhc2tEZWZpbml0aW9uQXJuO1xuXG4gICAgICAgIGxldCBlY3NIb3Rzd2FwUHJvcGVydGllcyA9IGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcy5lY3NIb3Rzd2FwUHJvcGVydGllcztcbiAgICAgICAgbGV0IG1pbmltdW1IZWFsdGh5UGVyY2VudCA9IGVjc0hvdHN3YXBQcm9wZXJ0aWVzPy5taW5pbXVtSGVhbHRoeVBlcmNlbnQ7XG4gICAgICAgIGxldCBtYXhpbXVtSGVhbHRoeVBlcmNlbnQgPSBlY3NIb3Rzd2FwUHJvcGVydGllcz8ubWF4aW11bUhlYWx0aHlQZXJjZW50O1xuXG4gICAgICAgIC8vIFN0ZXAgMiAtIHVwZGF0ZSB0aGUgc2VydmljZXMgdXNpbmcgdGhhdCBUYXNrRGVmaW5pdGlvbiB0byBwb2ludCB0byB0aGUgbmV3IFRhc2tEZWZpbml0aW9uIFJldmlzaW9uXG4gICAgICAgIC8vIEZvcmNpbmcgTmV3IERlcGxveW1lbnQgYW5kIHNldHRpbmcgTWluaW11bSBIZWFsdGh5IFBlcmNlbnQgdG8gMC5cbiAgICAgICAgLy8gQXMgQ0RLIEhvdFN3YXAgaXMgZGV2ZWxvcG1lbnQgb25seSwgdGhpcyBzZWVtcyB0aGUgbW9zdCBlZmZpY2llbnQgd2F5IHRvIGVuc3VyZSBhbGwgdGFza3MgYXJlIHJlcGxhY2VkIGltbWVkaWF0ZWx5LCByZWdhcmRsZXNzIG9mIG9yaWdpbmFsIGFtb3VudFxuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQGNka2xhYnMvcHJvbWlzZWFsbC1uby11bmJvdW5kZWQtcGFyYWxsZWxpc21cbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgZWNzU2VydmljZXNSZWZlcmVuY2luZ1Rhc2tEZWYubWFwKGFzeW5jIChzZXJ2aWNlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjbHVzdGVyID0gc2VydmljZS5zZXJ2aWNlQXJuLnNwbGl0KCcvJylbMV07XG4gICAgICAgICAgICBjb25zdCB1cGRhdGUgPSBhd2FpdCBzZGsuZWNzKCkudXBkYXRlU2VydmljZSh7XG4gICAgICAgICAgICAgIHNlcnZpY2U6IHNlcnZpY2Uuc2VydmljZUFybixcbiAgICAgICAgICAgICAgdGFza0RlZmluaXRpb246IHRhc2tEZWZSZXZBcm4sXG4gICAgICAgICAgICAgIGNsdXN0ZXIsXG4gICAgICAgICAgICAgIGZvcmNlTmV3RGVwbG95bWVudDogdHJ1ZSxcbiAgICAgICAgICAgICAgZGVwbG95bWVudENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgICAgICBtaW5pbXVtSGVhbHRoeVBlcmNlbnQ6IG1pbmltdW1IZWFsdGh5UGVyY2VudCAhPT0gdW5kZWZpbmVkID8gbWluaW11bUhlYWx0aHlQZXJjZW50IDogMCxcbiAgICAgICAgICAgICAgICBtYXhpbXVtUGVyY2VudDogbWF4aW11bUhlYWx0aHlQZXJjZW50ICE9PSB1bmRlZmluZWQgPyBtYXhpbXVtSGVhbHRoeVBlcmNlbnQgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgc2RrLmVjcygpLndhaXRVbnRpbFNlcnZpY2VzU3RhYmxlKHtcbiAgICAgICAgICAgICAgY2x1c3RlcjogdXBkYXRlLnNlcnZpY2U/LmNsdXN0ZXJBcm4sXG4gICAgICAgICAgICAgIHNlcnZpY2VzOiBbc2VydmljZS5zZXJ2aWNlQXJuXSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59XG5cbmludGVyZmFjZSBFY3NTZXJ2aWNlIHtcbiAgcmVhZG9ubHkgbG9naWNhbElkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHNlcnZpY2VBcm46IHN0cmluZztcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJlcGFyZVRhc2tEZWZpbml0aW9uQ2hhbmdlKFxuICBldmFsdWF0ZUNmblRlbXBsYXRlOiBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUsXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IFJlc291cmNlQ2hhbmdlLFxuKSB7XG4gIGNvbnN0IHRhc2tEZWZpbml0aW9uUmVzb3VyY2U6IHsgW25hbWU6IHN0cmluZ106IGFueSB9ID0ge1xuICAgIC4uLmNoYW5nZS5vbGRWYWx1ZS5Qcm9wZXJ0aWVzLFxuICAgIENvbnRhaW5lckRlZmluaXRpb25zOiBjaGFuZ2UubmV3VmFsdWUuUHJvcGVydGllcz8uQ29udGFpbmVyRGVmaW5pdGlvbnMsXG4gIH07XG4gIC8vIGZpcnN0LCBsZXQncyBnZXQgdGhlIG5hbWUgb2YgdGhlIGZhbWlseVxuICBjb25zdCBmYW1pbHlOYW1lT3JBcm4gPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmVzdGFibGlzaFJlc291cmNlUGh5c2ljYWxOYW1lKFxuICAgIGxvZ2ljYWxJZCxcbiAgICB0YXNrRGVmaW5pdGlvblJlc291cmNlPy5GYW1pbHksXG4gICk7XG4gIGlmICghZmFtaWx5TmFtZU9yQXJuKSB7XG4gICAgLy8gaWYgdGhlIEZhbWlseSBwcm9wZXJ0eSBoYXMgbm90IGJlZW4gcHJvdmlkZWQsIGFuZCB3ZSBjYW4ndCBmaW5kIGl0IGluIHRoZSBjdXJyZW50IFN0YWNrLFxuICAgIC8vIHRoaXMgbWVhbnMgaG90c3dhcHBpbmcgaXMgbm90IHBvc3NpYmxlXG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIHRoZSBwaHlzaWNhbCBuYW1lIG9mIHRoZSBUYXNrIERlZmluaXRpb24gaW4gQ2xvdWRGb3JtYXRpb24gaW5jbHVkZXMgaXRzIGN1cnJlbnQgcmV2aXNpb24gbnVtYmVyIGF0IHRoZSBlbmQsXG4gIC8vIHJlbW92ZSBpdCBpZiBuZWVkZWRcbiAgY29uc3QgZmFtaWx5TmFtZU9yQXJuUGFydHMgPSBmYW1pbHlOYW1lT3JBcm4uc3BsaXQoJzonKTtcbiAgY29uc3QgZmFtaWx5ID1cbiAgICBmYW1pbHlOYW1lT3JBcm5QYXJ0cy5sZW5ndGggPiAxXG4gICAgICA/IC8vIGZhbWlseU5hbWVPckFybiBpcyBhY3R1YWxseSBhbiBBUk4sIG9mIHRoZSBmb3JtYXQgJ2Fybjphd3M6ZWNzOnJlZ2lvbjphY2NvdW50OnRhc2stZGVmaW5pdGlvbi88ZmFtaWx5LW5hbWU+OjxyZXZpc2lvbi1ucj4nXG4gICAgLy8gc28sIHRha2UgdGhlIDZ0aCBlbGVtZW50LCBhdCBpbmRleCA1LCBhbmQgc3BsaXQgaXQgb24gJy8nXG4gICAgICBmYW1pbHlOYW1lT3JBcm5QYXJ0c1s1XS5zcGxpdCgnLycpWzFdXG4gICAgICA6IC8vIG90aGVyd2lzZSwgZmFtaWx5TmFtZU9yQXJuIGlzIGp1c3QgdGhlIHNpbXBsZSBuYW1lIGV2YWx1YXRlZCBmcm9tIHRoZSBDbG91ZEZvcm1hdGlvbiB0ZW1wbGF0ZVxuICAgICAgZmFtaWx5TmFtZU9yQXJuO1xuICAvLyB0aGVuLCBsZXQncyBldmFsdWF0ZSB0aGUgYm9keSBvZiB0aGUgcmVtYWluZGVyIG9mIHRoZSBUYXNrRGVmICh3aXRob3V0IHRoZSBGYW1pbHkgcHJvcGVydHkpXG4gIHJldHVybiB7XG4gICAgLi4uKGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKHtcbiAgICAgIC4uLih0YXNrRGVmaW5pdGlvblJlc291cmNlID8/IHt9KSxcbiAgICAgIEZhbWlseTogdW5kZWZpbmVkLFxuICAgIH0pKSxcbiAgICBGYW1pbHk6IGZhbWlseSxcbiAgfTtcbn1cbiJdfQ==