import {
  type HotswapChange,
  classifyChanges,
} from './common';
import type { ResourceChange } from '../../payloads/hotswap';
import type { SDK } from '../aws-auth/private';

import type { EvaluateCloudFormationTemplate } from '../cloudformation';

export async function isHotswappableAppSyncChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<HotswapChange[]> {
  const isResolver = change.newValue.Type === 'AWS::AppSync::Resolver';
  const isFunction = change.newValue.Type === 'AWS::AppSync::FunctionConfiguration';
  const isGraphQLSchema = change.newValue.Type === 'AWS::AppSync::GraphQLSchema';
  const isAPIKey = change.newValue.Type === 'AWS::AppSync::ApiKey';
  if (!isResolver && !isFunction && !isGraphQLSchema && !isAPIKey) {
    return [];
  }

  const ret: HotswapChange[] = [];

  const classifiedChanges = classifyChanges(change, [
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
    let physicalName: string | undefined = undefined;
    const arn = await evaluateCfnTemplate.establishResourcePhysicalName(
      logicalId,
      isFunction ? change.newValue.Properties?.Name : undefined,
    );
    physicalName = arn;

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
      apply: async (sdk: SDK) => {
        const patchOps: Array<{ op: string; path: string; value: any }> = [];
        for (const propName of namesOfHotswappableChanges) {
          patchOps.push({
            op: 'replace',
            path: `/${propName}`,
            value: await evaluateCfnTemplate.evaluateCfnExpression(
              change.propertyUpdates[propName].newValue,
            ),
          });
        }

        await sdk.cloudControl().updateResource({
          TypeName: change.newValue.Type,
          Identifier: physicalName,
          PatchDocument: JSON.stringify(patchOps),
        });
      },
    });
  }

  return ret;
}
