import { type HotswapChange, classifyChanges } from './common';
import type { ResourceChange } from '../../payloads/hotswap';
import type { SDK } from '../aws-auth/private';
import type { EvaluateCloudFormationTemplate } from '../cloudformation';

const QUICKSIGHT_RESOURCE_TYPES: Record<string, { hotswappableProps: string[]; service: string }> = {
  'AWS::QuickSight::DataSet': { hotswappableProps: ['PhysicalTableMap', 'LogicalTableMap', 'Name'], service: 'quicksight-dataset' },
  'AWS::QuickSight::DataSource': { hotswappableProps: ['DataSourceParameters', 'Name', 'Credentials'], service: 'quicksight-datasource' },
  'AWS::QuickSight::Dashboard': { hotswappableProps: ['Definition', 'Name', 'SourceEntity'], service: 'quicksight-dashboard' },
  'AWS::QuickSight::Analysis': { hotswappableProps: ['Definition', 'Name', 'SourceEntity'], service: 'quicksight-analysis' },
  'AWS::QuickSight::Template': { hotswappableProps: ['Definition', 'Name', 'SourceEntity'], service: 'quicksight-template' },
};

export async function isHotswappableQuickSightChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<HotswapChange[]> {
  const resourceConfig = QUICKSIGHT_RESOURCE_TYPES[change.newValue.Type];
  if (!resourceConfig) {
    return [];
  }

  const ret: HotswapChange[] = [];
  const classifiedChanges = classifyChanges(change, resourceConfig.hotswappableProps);
  classifiedChanges.reportNonHotswappablePropertyChanges(ret);

  if (classifiedChanges.namesOfHotswappableProps.length === 0) {
    return ret;
  }

  const awsAccountId = change.newValue.Properties?.AwsAccountId
    ? await evaluateCfnTemplate.evaluateCfnExpression(change.newValue.Properties.AwsAccountId)
    : await evaluateCfnTemplate.evaluateCfnExpression({ Ref: 'AWS::AccountId' });

  const resourceId = await evaluateCfnTemplate.establishResourcePhysicalName(
    logicalId,
    change.newValue.Properties?.DataSetId ??
    change.newValue.Properties?.DataSourceId ??
    change.newValue.Properties?.DashboardId ??
    change.newValue.Properties?.AnalysisId ??
    change.newValue.Properties?.TemplateId,
  );

  if (!resourceId) {
    return ret;
  }

  ret.push({
    change: {
      cause: change,
      resources: [{
        logicalId,
        resourceType: change.newValue.Type,
        physicalName: resourceId,
        metadata: evaluateCfnTemplate.metadataFor(logicalId),
      }],
    },
    hotswappable: true,
    service: resourceConfig.service,
    apply: async (sdk: SDK) => {
      const props = change.newValue.Properties ?? {};
      const evaluatedProps: Record<string, any> = {};

      for (const propName of classifiedChanges.namesOfHotswappableProps) {
        if (props[propName] !== undefined) {
          evaluatedProps[propName] = await evaluateCfnTemplate.evaluateCfnExpression(props[propName]);
        }
      }

      switch (change.newValue.Type) {
        case 'AWS::QuickSight::DataSet':
          await sdk.quickSight().updateDataSet({
            AwsAccountId: awsAccountId,
            DataSetId: resourceId,
            Name: evaluatedProps.Name ?? props.Name,
            PhysicalTableMap: evaluatedProps.PhysicalTableMap,
            LogicalTableMap: evaluatedProps.LogicalTableMap,
            ImportMode: props.ImportMode,
          });
          break;
        case 'AWS::QuickSight::DataSource':
          await sdk.quickSight().updateDataSource({
            AwsAccountId: awsAccountId,
            DataSourceId: resourceId,
            Name: evaluatedProps.Name ?? props.Name,
            DataSourceParameters: evaluatedProps.DataSourceParameters,
            Credentials: evaluatedProps.Credentials,
          });
          break;
        case 'AWS::QuickSight::Dashboard':
          await sdk.quickSight().updateDashboard({
            AwsAccountId: awsAccountId,
            DashboardId: resourceId,
            Name: evaluatedProps.Name ?? props.Name,
            Definition: evaluatedProps.Definition,
            SourceEntity: evaluatedProps.SourceEntity,
          });
          break;
        case 'AWS::QuickSight::Analysis':
          await sdk.quickSight().updateAnalysis({
            AwsAccountId: awsAccountId,
            AnalysisId: resourceId,
            Name: evaluatedProps.Name ?? props.Name,
            Definition: evaluatedProps.Definition,
            SourceEntity: evaluatedProps.SourceEntity,
          });
          break;
        case 'AWS::QuickSight::Template':
          await sdk.quickSight().updateTemplate({
            AwsAccountId: awsAccountId,
            TemplateId: resourceId,
            Name: evaluatedProps.Name ?? props.Name,
            Definition: evaluatedProps.Definition,
            SourceEntity: evaluatedProps.SourceEntity,
          });
          break;
      }
    },
  });

  return ret;
}
