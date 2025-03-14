import { type ChangeHotswapResult, classifyChanges } from './common';
import type { ResourceChange } from '../../../../@aws-cdk/tmp-toolkit-helpers';
import type { SDK } from '../aws-auth';
import type { EvaluateCloudFormationTemplate } from '../evaluate-cloudformation-template';

export async function isHotswappableStateMachineChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<ChangeHotswapResult> {
  if (change.newValue.Type !== 'AWS::StepFunctions::StateMachine') {
    return [];
  }
  const ret: ChangeHotswapResult = [];
  const classifiedChanges = classifyChanges(change, ['DefinitionString']);
  classifiedChanges.reportNonHotswappablePropertyChanges(ret);

  const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
  if (namesOfHotswappableChanges.length > 0) {
    const stateMachineNameInCfnTemplate = change.newValue?.Properties?.StateMachineName;
    const stateMachineArn = stateMachineNameInCfnTemplate
      ? await evaluateCfnTemplate.evaluateCfnExpression({
        'Fn::Sub':
            'arn:${AWS::Partition}:states:${AWS::Region}:${AWS::AccountId}:stateMachine:' +
            stateMachineNameInCfnTemplate,
      })
      : await evaluateCfnTemplate.findPhysicalNameFor(logicalId);
    ret.push({
      change: {
        cause: change,
        resources: [{
          logicalId,
          resourceType: change.newValue.Type,
          physicalName: stateMachineArn?.split(':')[6],
          metadata: evaluateCfnTemplate.metadataFor(logicalId),
        }],
      },
      hotswappable: true,
      service: 'stepfunctions-service',
      apply: async (sdk: SDK) => {
        if (!stateMachineArn) {
          return;
        }

        // not passing the optional properties leaves them unchanged
        await sdk.stepFunctions().updateStateMachine({
          stateMachineArn,
          definition: await evaluateCfnTemplate.evaluateCfnExpression(change.propertyUpdates.DefinitionString.newValue),
        });
      },
    });
  }

  return ret;
}
