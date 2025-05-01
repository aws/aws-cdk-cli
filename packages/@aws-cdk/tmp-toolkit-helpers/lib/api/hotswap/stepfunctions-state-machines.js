"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHotswappableStateMachineChange = isHotswappableStateMachineChange;
const common_1 = require("./common");
async function isHotswappableStateMachineChange(logicalId, change, evaluateCfnTemplate) {
    if (change.newValue.Type !== 'AWS::StepFunctions::StateMachine') {
        return [];
    }
    const ret = [];
    const classifiedChanges = (0, common_1.classifyChanges)(change, ['DefinitionString']);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
    if (namesOfHotswappableChanges.length > 0) {
        const stateMachineNameInCfnTemplate = change.newValue?.Properties?.StateMachineName;
        const stateMachineArn = stateMachineNameInCfnTemplate
            ? await evaluateCfnTemplate.evaluateCfnExpression({
                'Fn::Sub': 'arn:${AWS::Partition}:states:${AWS::Region}:${AWS::AccountId}:stateMachine:' +
                    stateMachineNameInCfnTemplate,
            })
            : await evaluateCfnTemplate.findPhysicalNameFor(logicalId);
        // nothing to do
        if (!stateMachineArn) {
            return ret;
        }
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
            apply: async (sdk) => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RlcGZ1bmN0aW9ucy1zdGF0ZS1tYWNoaW5lcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvaG90c3dhcC9zdGVwZnVuY3Rpb25zLXN0YXRlLW1hY2hpbmVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBS0EsNEVBbURDO0FBeERELHFDQUErRDtBQUt4RCxLQUFLLFVBQVUsZ0NBQWdDLENBQ3BELFNBQWlCLEVBQ2pCLE1BQXNCLEVBQ3RCLG1CQUFtRDtJQUVuRCxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLGtDQUFrQyxFQUFFLENBQUM7UUFDaEUsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0lBQ0QsTUFBTSxHQUFHLEdBQW9CLEVBQUUsQ0FBQztJQUNoQyxNQUFNLGlCQUFpQixHQUFHLElBQUEsd0JBQWUsRUFBQyxNQUFNLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUM7SUFDeEUsaUJBQWlCLENBQUMsb0NBQW9DLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFNUQsTUFBTSwwQkFBMEIsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLGlCQUFpQixDQUFDLENBQUM7SUFDcEYsSUFBSSwwQkFBMEIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDMUMsTUFBTSw2QkFBNkIsR0FBRyxNQUFNLENBQUMsUUFBUSxFQUFFLFVBQVUsRUFBRSxnQkFBZ0IsQ0FBQztRQUNwRixNQUFNLGVBQWUsR0FBRyw2QkFBNkI7WUFDbkQsQ0FBQyxDQUFDLE1BQU0sbUJBQW1CLENBQUMscUJBQXFCLENBQUM7Z0JBQ2hELFNBQVMsRUFDTCw2RUFBNkU7b0JBQzdFLDZCQUE2QjthQUNsQyxDQUFDO1lBQ0YsQ0FBQyxDQUFDLE1BQU0sbUJBQW1CLENBQUMsbUJBQW1CLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFN0QsZ0JBQWdCO1FBQ2hCLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNyQixPQUFPLEdBQUcsQ0FBQztRQUNiLENBQUM7UUFFRCxHQUFHLENBQUMsSUFBSSxDQUFDO1lBQ1AsTUFBTSxFQUFFO2dCQUNOLEtBQUssRUFBRSxNQUFNO2dCQUNiLFNBQVMsRUFBRSxDQUFDO3dCQUNWLFNBQVM7d0JBQ1QsWUFBWSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSTt3QkFDbEMsWUFBWSxFQUFFLGVBQWUsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUM1QyxRQUFRLEVBQUUsbUJBQW1CLENBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQztxQkFDckQsQ0FBQzthQUNIO1lBQ0QsWUFBWSxFQUFFLElBQUk7WUFDbEIsT0FBTyxFQUFFLHVCQUF1QjtZQUNoQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEdBQVEsRUFBRSxFQUFFO2dCQUN4Qiw0REFBNEQ7Z0JBQzVELE1BQU0sR0FBRyxDQUFDLGFBQWEsRUFBRSxDQUFDLGtCQUFrQixDQUFDO29CQUMzQyxlQUFlO29CQUNmLFVBQVUsRUFBRSxNQUFNLG1CQUFtQixDQUFDLHFCQUFxQixDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxDQUFDO2lCQUM5RyxDQUFDLENBQUM7WUFDTCxDQUFDO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHR5cGUgSG90c3dhcENoYW5nZSwgY2xhc3NpZnlDaGFuZ2VzIH0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHR5cGUgeyBSZXNvdXJjZUNoYW5nZSB9IGZyb20gJy4uLy4uL3BheWxvYWRzL2hvdHN3YXAnO1xuaW1wb3J0IHR5cGUgeyBTREsgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgdHlwZSB7IEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZSB9IGZyb20gJy4uL2Nsb3VkZm9ybWF0aW9uJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzSG90c3dhcHBhYmxlU3RhdGVNYWNoaW5lQ2hhbmdlKFxuICBsb2dpY2FsSWQ6IHN0cmluZyxcbiAgY2hhbmdlOiBSZXNvdXJjZUNoYW5nZSxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuKTogUHJvbWlzZTxIb3Rzd2FwQ2hhbmdlW10+IHtcbiAgaWYgKGNoYW5nZS5uZXdWYWx1ZS5UeXBlICE9PSAnQVdTOjpTdGVwRnVuY3Rpb25zOjpTdGF0ZU1hY2hpbmUnKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIGNvbnN0IHJldDogSG90c3dhcENoYW5nZVtdID0gW107XG4gIGNvbnN0IGNsYXNzaWZpZWRDaGFuZ2VzID0gY2xhc3NpZnlDaGFuZ2VzKGNoYW5nZSwgWydEZWZpbml0aW9uU3RyaW5nJ10pO1xuICBjbGFzc2lmaWVkQ2hhbmdlcy5yZXBvcnROb25Ib3Rzd2FwcGFibGVQcm9wZXJ0eUNoYW5nZXMocmV0KTtcblxuICBjb25zdCBuYW1lc09mSG90c3dhcHBhYmxlQ2hhbmdlcyA9IE9iamVjdC5rZXlzKGNsYXNzaWZpZWRDaGFuZ2VzLmhvdHN3YXBwYWJsZVByb3BzKTtcbiAgaWYgKG5hbWVzT2ZIb3Rzd2FwcGFibGVDaGFuZ2VzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBzdGF0ZU1hY2hpbmVOYW1lSW5DZm5UZW1wbGF0ZSA9IGNoYW5nZS5uZXdWYWx1ZT8uUHJvcGVydGllcz8uU3RhdGVNYWNoaW5lTmFtZTtcbiAgICBjb25zdCBzdGF0ZU1hY2hpbmVBcm4gPSBzdGF0ZU1hY2hpbmVOYW1lSW5DZm5UZW1wbGF0ZVxuICAgICAgPyBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih7XG4gICAgICAgICdGbjo6U3ViJzpcbiAgICAgICAgICAgICdhcm46JHtBV1M6OlBhcnRpdGlvbn06c3RhdGVzOiR7QVdTOjpSZWdpb259OiR7QVdTOjpBY2NvdW50SWR9OnN0YXRlTWFjaGluZTonICtcbiAgICAgICAgICAgIHN0YXRlTWFjaGluZU5hbWVJbkNmblRlbXBsYXRlLFxuICAgICAgfSlcbiAgICAgIDogYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5maW5kUGh5c2ljYWxOYW1lRm9yKGxvZ2ljYWxJZCk7XG5cbiAgICAvLyBub3RoaW5nIHRvIGRvXG4gICAgaWYgKCFzdGF0ZU1hY2hpbmVBcm4pIHtcbiAgICAgIHJldHVybiByZXQ7XG4gICAgfVxuXG4gICAgcmV0LnB1c2goe1xuICAgICAgY2hhbmdlOiB7XG4gICAgICAgIGNhdXNlOiBjaGFuZ2UsXG4gICAgICAgIHJlc291cmNlczogW3tcbiAgICAgICAgICBsb2dpY2FsSWQsXG4gICAgICAgICAgcmVzb3VyY2VUeXBlOiBjaGFuZ2UubmV3VmFsdWUuVHlwZSxcbiAgICAgICAgICBwaHlzaWNhbE5hbWU6IHN0YXRlTWFjaGluZUFybj8uc3BsaXQoJzonKVs2XSxcbiAgICAgICAgICBtZXRhZGF0YTogZXZhbHVhdGVDZm5UZW1wbGF0ZS5tZXRhZGF0YUZvcihsb2dpY2FsSWQpLFxuICAgICAgICB9XSxcbiAgICAgIH0sXG4gICAgICBob3Rzd2FwcGFibGU6IHRydWUsXG4gICAgICBzZXJ2aWNlOiAnc3RlcGZ1bmN0aW9ucy1zZXJ2aWNlJyxcbiAgICAgIGFwcGx5OiBhc3luYyAoc2RrOiBTREspID0+IHtcbiAgICAgICAgLy8gbm90IHBhc3NpbmcgdGhlIG9wdGlvbmFsIHByb3BlcnRpZXMgbGVhdmVzIHRoZW0gdW5jaGFuZ2VkXG4gICAgICAgIGF3YWl0IHNkay5zdGVwRnVuY3Rpb25zKCkudXBkYXRlU3RhdGVNYWNoaW5lKHtcbiAgICAgICAgICBzdGF0ZU1hY2hpbmVBcm4sXG4gICAgICAgICAgZGVmaW5pdGlvbjogYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24oY2hhbmdlLnByb3BlcnR5VXBkYXRlcy5EZWZpbml0aW9uU3RyaW5nLm5ld1ZhbHVlKSxcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHJldDtcbn1cbiJdfQ==