import type { UpdateProjectCommandInput } from '@aws-sdk/client-codebuild';
import {
  type HotswapChange,
  classifyChanges,
} from './common';
import type { ResourceChange } from '../../payloads/hotswap';
import { lowerCaseFirstCharacter, transformObjectKeys } from '../../util';
import type { SDK } from '../aws-auth/private';
import type { EvaluateCloudFormationTemplate } from '../cloudformation';

export async function isHotswappableCodeBuildProjectChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<HotswapChange[]> {
  if (change.newValue.Type !== 'AWS::CodeBuild::Project') {
    return [];
  }

  const ret: HotswapChange[] = [];

  const classifiedChanges = classifyChanges(change, ['Source', 'Environment', 'SourceVersion']);
  classifiedChanges.reportNonHotswappablePropertyChanges(ret);
  if (classifiedChanges.namesOfHotswappableProps.length > 0) {
    const updateProjectInput: UpdateProjectCommandInput = {
      name: '',
    };
    const projectName = await evaluateCfnTemplate.establishResourcePhysicalName(
      logicalId,
      change.newValue.Properties?.Name,
    );

    // nothing to do jere
    if (!projectName) {
      return ret;
    }

    ret.push({
      change: {
        cause: change,
        resources: [{
          logicalId: logicalId,
          resourceType: change.newValue.Type,
          physicalName: projectName,
          metadata: evaluateCfnTemplate.metadataFor(logicalId),
        }],
      },
      hotswappable: true,
      service: 'codebuild',
      apply: async (sdk: SDK) => {
        updateProjectInput.name = projectName;

        for (const updatedPropName in change.propertyUpdates) {
          const updatedProp = change.propertyUpdates[updatedPropName];
          switch (updatedPropName) {
            case 'Source':
              updateProjectInput.source = transformObjectKeys(
                await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue),
                convertSourceCloudformationKeyToSdkKey,
              );
              break;
            case 'Environment':
              updateProjectInput.environment = await transformObjectKeys(
                await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue),
                lowerCaseFirstCharacter,
              );
              break;
            case 'SourceVersion':
              updateProjectInput.sourceVersion = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue);
              break;
          }
        }

        await sdk.codeBuild().updateProject(updateProjectInput);
      },
    });
  }

  return ret;
}

function convertSourceCloudformationKeyToSdkKey(key: string): string {
  if (key.toLowerCase() === 'buildspec') {
    return key.toLowerCase();
  }
  return lowerCaseFirstCharacter(key);
}
