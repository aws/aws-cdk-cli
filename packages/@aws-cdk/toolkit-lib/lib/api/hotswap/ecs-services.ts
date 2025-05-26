import type {
  HotswapPropertyOverrides,
  HotswapChange,
} from './common';
import {
  classifyChanges,
  nonHotswappableChange,
} from './common';
import { NonHotswappableReason, type ResourceChange } from '../../payloads/hotswap';
import { lowerCaseFirstCharacter, transformObjectKeys } from '../../util';
import type { SDK } from '../aws-auth/private';
import type { EvaluateCloudFormationTemplate } from '../cloudformation';

const ECS_SERVICE_RESOURCE_TYPE = 'AWS::ECS::Service';

export async function isHotswappableEcsServiceChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  hotswapPropertyOverrides: HotswapPropertyOverrides,
): Promise<HotswapChange[]> {
  // the only resource change we can evaluate here is an ECS TaskDefinition
  if (change.newValue.Type !== 'AWS::ECS::TaskDefinition') {
    return [];
  }

  const ret: HotswapChange[] = [];

  // We only allow a change in the ContainerDefinitions of the TaskDefinition for now -
  // it contains the image and environment variables, so seems like a safe bet for now.
  // We might revisit this decision in the future though!
  const classifiedChanges = classifyChanges(change, ['ContainerDefinitions']);
  classifiedChanges.reportNonHotswappablePropertyChanges(ret);

  // find all ECS Services that reference the TaskDefinition that changed
  const resourcesReferencingTaskDef = evaluateCfnTemplate.findReferencesTo(logicalId);
  const ecsServiceResourcesReferencingTaskDef = resourcesReferencingTaskDef.filter(
    (r) => r.Type === ECS_SERVICE_RESOURCE_TYPE,
  );
  const ecsServicesReferencingTaskDef = new Array<EcsService>();
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
    ret.push(nonHotswappableChange(
      change,
      NonHotswappableReason.DEPENDENCY_UNSUPPORTED,
      'No ECS services reference the changed task definition',
      undefined,
      false,
    ));
  }
  if (resourcesReferencingTaskDef.length > ecsServicesReferencingTaskDef.length) {
    // if something besides an ECS Service is referencing the TaskDefinition,
    // hotswap is not possible in FALL_BACK mode
    const nonEcsServiceTaskDefRefs = resourcesReferencingTaskDef.filter((r) => r.Type !== ECS_SERVICE_RESOURCE_TYPE);
    for (const taskRef of nonEcsServiceTaskDefRefs) {
      ret.push(nonHotswappableChange(
        change,
        NonHotswappableReason.DEPENDENCY_UNSUPPORTED,
        `A resource '${taskRef.LogicalId}' with Type '${taskRef.Type}' that is not an ECS Service was found referencing the changed TaskDefinition '${logicalId}'`,
      ));
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
      apply: async (sdk: SDK) => {
        // Step 1 - update the changed TaskDefinition, creating a new TaskDefinition Revision
        // we need to lowercase the evaluated TaskDef from CloudFormation,
        // as the AWS SDK uses lowercase property names for these

        // The SDK requires more properties here than its worth doing explicit typing for
        // instead, just use all the old values in the diff to fill them in implicitly
        const lowercasedTaskDef = transformObjectKeys(taskDefinitionResource, lowerCaseFirstCharacter, {
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

        let ecsHotswapProperties = hotswapPropertyOverrides.ecs;
        let minimumHealthyPercent = ecsHotswapProperties?.minimumHealthyPercent;
        let maximumHealthyPercent = ecsHotswapProperties?.maximumHealthyPercent;
        let stabilizationTimeoutSeconds = ecsHotswapProperties?.stabilizationTimeoutSeconds;

        // Step 2 - update the services using that TaskDefinition to point to the new TaskDefinition Revision
        // Forcing New Deployment and setting Minimum Healthy Percent to 0.
        // As CDK HotSwap is development only, this seems the most efficient way to ensure all tasks are replaced immediately, regardless of original amount
        // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
        await Promise.all(
          ecsServicesReferencingTaskDef.map(async (service) => {
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
            }, stabilizationTimeoutSeconds);
          }),
        );
      },
    });
  }

  return ret;
}

interface EcsService {
  readonly logicalId: string;
  readonly serviceArn: string;
}

async function prepareTaskDefinitionChange(
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  logicalId: string,
  change: ResourceChange,
) {
  const taskDefinitionResource: { [name: string]: any } = {
    ...change.oldValue.Properties,
    ContainerDefinitions: change.newValue.Properties?.ContainerDefinitions,
  };
  // first, let's get the name of the family
  const familyNameOrArn = await evaluateCfnTemplate.establishResourcePhysicalName(
    logicalId,
    taskDefinitionResource?.Family,
  );
  if (!familyNameOrArn) {
    // if the Family property has not been provided, and we can't find it in the current Stack,
    // this means hotswapping is not possible
    return;
  }
  // the physical name of the Task Definition in CloudFormation includes its current revision number at the end,
  // remove it if needed
  const familyNameOrArnParts = familyNameOrArn.split(':');
  const family =
    familyNameOrArnParts.length > 1
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
