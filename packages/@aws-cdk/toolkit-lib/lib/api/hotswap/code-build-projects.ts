import {
  type HotswapChange,
  classifyChanges,
} from './common';
import type { ResourceChange } from '../../payloads/hotswap';
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
        const patchOps: Array<{ op: string; path: string; value: any }> = [];

        for (const updatedPropName in change.propertyUpdates) {
          const updatedProp = change.propertyUpdates[updatedPropName];
          switch (updatedPropName) {
            case 'Source':
              patchOps.push({ op: 'replace', path: '/Source', value: await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue) });
              break;
            case 'Environment':
              patchOps.push({ op: 'replace', path: '/Environment', value: await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue) });
              break;
            case 'SourceVersion':
              patchOps.push({ op: 'replace', path: '/SourceVersion', value: await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue) });
              break;
          }
        }

        await sdk.cloudControl().updateResource({
          TypeName: 'AWS::CodeBuild::Project',
          Identifier: projectName,
          PatchDocument: JSON.stringify(patchOps),
        });
      },
    });
  }

  return ret;
}

// function convertSourceCloudformationKeyToSdkKey(key: string): string {
//   if (key.toLowerCase() === 'buildspec') {
//     return key.toLowerCase();
//   }
//   return lowerCaseFirstCharacter(key);
// }
