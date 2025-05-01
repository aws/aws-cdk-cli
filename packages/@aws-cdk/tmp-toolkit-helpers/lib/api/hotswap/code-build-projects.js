"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHotswappableCodeBuildProjectChange = isHotswappableCodeBuildProjectChange;
const common_1 = require("./common");
const util_1 = require("../../util");
async function isHotswappableCodeBuildProjectChange(logicalId, change, evaluateCfnTemplate) {
    if (change.newValue.Type !== 'AWS::CodeBuild::Project') {
        return [];
    }
    const ret = [];
    const classifiedChanges = (0, common_1.classifyChanges)(change, ['Source', 'Environment', 'SourceVersion']);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    if (classifiedChanges.namesOfHotswappableProps.length > 0) {
        const updateProjectInput = {
            name: '',
        };
        const projectName = await evaluateCfnTemplate.establishResourcePhysicalName(logicalId, change.newValue.Properties?.Name);
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
            apply: async (sdk) => {
                updateProjectInput.name = projectName;
                for (const updatedPropName in change.propertyUpdates) {
                    const updatedProp = change.propertyUpdates[updatedPropName];
                    switch (updatedPropName) {
                        case 'Source':
                            updateProjectInput.source = (0, util_1.transformObjectKeys)(await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue), convertSourceCloudformationKeyToSdkKey);
                            break;
                        case 'Environment':
                            updateProjectInput.environment = await (0, util_1.transformObjectKeys)(await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue), util_1.lowerCaseFirstCharacter);
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
function convertSourceCloudformationKeyToSdkKey(key) {
    if (key.toLowerCase() === 'buildspec') {
        return key.toLowerCase();
    }
    return (0, util_1.lowerCaseFirstCharacter)(key);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZS1idWlsZC1wcm9qZWN0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvaG90c3dhcC9jb2RlLWJ1aWxkLXByb2plY3RzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBVUEsb0ZBcUVDO0FBOUVELHFDQUdrQjtBQUVsQixxQ0FBMEU7QUFJbkUsS0FBSyxVQUFVLG9DQUFvQyxDQUN4RCxTQUFpQixFQUNqQixNQUFzQixFQUN0QixtQkFBbUQ7SUFFbkQsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksS0FBSyx5QkFBeUIsRUFBRSxDQUFDO1FBQ3ZELE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVELE1BQU0sR0FBRyxHQUFvQixFQUFFLENBQUM7SUFFaEMsTUFBTSxpQkFBaUIsR0FBRyxJQUFBLHdCQUFlLEVBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxFQUFFLGFBQWEsRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFDO0lBQzlGLGlCQUFpQixDQUFDLG9DQUFvQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQzVELElBQUksaUJBQWlCLENBQUMsd0JBQXdCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzFELE1BQU0sa0JBQWtCLEdBQThCO1lBQ3BELElBQUksRUFBRSxFQUFFO1NBQ1QsQ0FBQztRQUNGLE1BQU0sV0FBVyxHQUFHLE1BQU0sbUJBQW1CLENBQUMsNkJBQTZCLENBQ3pFLFNBQVMsRUFDVCxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQ2pDLENBQUM7UUFFRixxQkFBcUI7UUFDckIsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ2pCLE9BQU8sR0FBRyxDQUFDO1FBQ2IsQ0FBQztRQUVELEdBQUcsQ0FBQyxJQUFJLENBQUM7WUFDUCxNQUFNLEVBQUU7Z0JBQ04sS0FBSyxFQUFFLE1BQU07Z0JBQ2IsU0FBUyxFQUFFLENBQUM7d0JBQ1YsU0FBUyxFQUFFLFNBQVM7d0JBQ3BCLFlBQVksRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUk7d0JBQ2xDLFlBQVksRUFBRSxXQUFXO3dCQUN6QixRQUFRLEVBQUUsbUJBQW1CLENBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQztxQkFDckQsQ0FBQzthQUNIO1lBQ0QsWUFBWSxFQUFFLElBQUk7WUFDbEIsT0FBTyxFQUFFLFdBQVc7WUFDcEIsS0FBSyxFQUFFLEtBQUssRUFBRSxHQUFRLEVBQUUsRUFBRTtnQkFDeEIsa0JBQWtCLENBQUMsSUFBSSxHQUFHLFdBQVcsQ0FBQztnQkFFdEMsS0FBSyxNQUFNLGVBQWUsSUFBSSxNQUFNLENBQUMsZUFBZSxFQUFFLENBQUM7b0JBQ3JELE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxlQUFlLENBQUMsZUFBZSxDQUFDLENBQUM7b0JBQzVELFFBQVEsZUFBZSxFQUFFLENBQUM7d0JBQ3hCLEtBQUssUUFBUTs0QkFDWCxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsSUFBQSwwQkFBbUIsRUFDN0MsTUFBTSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLEVBQ3JFLHNDQUFzQyxDQUN2QyxDQUFDOzRCQUNGLE1BQU07d0JBQ1IsS0FBSyxhQUFhOzRCQUNoQixrQkFBa0IsQ0FBQyxXQUFXLEdBQUcsTUFBTSxJQUFBLDBCQUFtQixFQUN4RCxNQUFNLG1CQUFtQixDQUFDLHFCQUFxQixDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsRUFDckUsOEJBQXVCLENBQ3hCLENBQUM7NEJBQ0YsTUFBTTt3QkFDUixLQUFLLGVBQWU7NEJBQ2xCLGtCQUFrQixDQUFDLGFBQWEsR0FBRyxNQUFNLG1CQUFtQixDQUFDLHFCQUFxQixDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQzs0QkFDekcsTUFBTTtvQkFDVixDQUFDO2dCQUNILENBQUM7Z0JBRUQsTUFBTSxHQUFHLENBQUMsU0FBUyxFQUFFLENBQUMsYUFBYSxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDMUQsQ0FBQztTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLEdBQUcsQ0FBQztBQUNiLENBQUM7QUFFRCxTQUFTLHNDQUFzQyxDQUFDLEdBQVc7SUFDekQsSUFBSSxHQUFHLENBQUMsV0FBVyxFQUFFLEtBQUssV0FBVyxFQUFFLENBQUM7UUFDdEMsT0FBTyxHQUFHLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUNELE9BQU8sSUFBQSw4QkFBdUIsRUFBQyxHQUFHLENBQUMsQ0FBQztBQUN0QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBVcGRhdGVQcm9qZWN0Q29tbWFuZElucHV0IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNvZGVidWlsZCc7XG5pbXBvcnQge1xuICB0eXBlIEhvdHN3YXBDaGFuZ2UsXG4gIGNsYXNzaWZ5Q2hhbmdlcyxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHR5cGUgeyBSZXNvdXJjZUNoYW5nZSB9IGZyb20gJy4uLy4uL3BheWxvYWRzL2hvdHN3YXAnO1xuaW1wb3J0IHsgbG93ZXJDYXNlRmlyc3RDaGFyYWN0ZXIsIHRyYW5zZm9ybU9iamVjdEtleXMgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB0eXBlIHsgU0RLIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHR5cGUgeyBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUgfSBmcm9tICcuLi9jbG91ZGZvcm1hdGlvbic7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpc0hvdHN3YXBwYWJsZUNvZGVCdWlsZFByb2plY3RDaGFuZ2UoXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IFJlc291cmNlQ2hhbmdlLFxuICBldmFsdWF0ZUNmblRlbXBsYXRlOiBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUsXG4pOiBQcm9taXNlPEhvdHN3YXBDaGFuZ2VbXT4ge1xuICBpZiAoY2hhbmdlLm5ld1ZhbHVlLlR5cGUgIT09ICdBV1M6OkNvZGVCdWlsZDo6UHJvamVjdCcpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCByZXQ6IEhvdHN3YXBDaGFuZ2VbXSA9IFtdO1xuXG4gIGNvbnN0IGNsYXNzaWZpZWRDaGFuZ2VzID0gY2xhc3NpZnlDaGFuZ2VzKGNoYW5nZSwgWydTb3VyY2UnLCAnRW52aXJvbm1lbnQnLCAnU291cmNlVmVyc2lvbiddKTtcbiAgY2xhc3NpZmllZENoYW5nZXMucmVwb3J0Tm9uSG90c3dhcHBhYmxlUHJvcGVydHlDaGFuZ2VzKHJldCk7XG4gIGlmIChjbGFzc2lmaWVkQ2hhbmdlcy5uYW1lc09mSG90c3dhcHBhYmxlUHJvcHMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHVwZGF0ZVByb2plY3RJbnB1dDogVXBkYXRlUHJvamVjdENvbW1hbmRJbnB1dCA9IHtcbiAgICAgIG5hbWU6ICcnLFxuICAgIH07XG4gICAgY29uc3QgcHJvamVjdE5hbWUgPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmVzdGFibGlzaFJlc291cmNlUGh5c2ljYWxOYW1lKFxuICAgICAgbG9naWNhbElkLFxuICAgICAgY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/Lk5hbWUsXG4gICAgKTtcblxuICAgIC8vIG5vdGhpbmcgdG8gZG8gamVyZVxuICAgIGlmICghcHJvamVjdE5hbWUpIHtcbiAgICAgIHJldHVybiByZXQ7XG4gICAgfVxuXG4gICAgcmV0LnB1c2goe1xuICAgICAgY2hhbmdlOiB7XG4gICAgICAgIGNhdXNlOiBjaGFuZ2UsXG4gICAgICAgIHJlc291cmNlczogW3tcbiAgICAgICAgICBsb2dpY2FsSWQ6IGxvZ2ljYWxJZCxcbiAgICAgICAgICByZXNvdXJjZVR5cGU6IGNoYW5nZS5uZXdWYWx1ZS5UeXBlLFxuICAgICAgICAgIHBoeXNpY2FsTmFtZTogcHJvamVjdE5hbWUsXG4gICAgICAgICAgbWV0YWRhdGE6IGV2YWx1YXRlQ2ZuVGVtcGxhdGUubWV0YWRhdGFGb3IobG9naWNhbElkKSxcbiAgICAgICAgfV0sXG4gICAgICB9LFxuICAgICAgaG90c3dhcHBhYmxlOiB0cnVlLFxuICAgICAgc2VydmljZTogJ2NvZGVidWlsZCcsXG4gICAgICBhcHBseTogYXN5bmMgKHNkazogU0RLKSA9PiB7XG4gICAgICAgIHVwZGF0ZVByb2plY3RJbnB1dC5uYW1lID0gcHJvamVjdE5hbWU7XG5cbiAgICAgICAgZm9yIChjb25zdCB1cGRhdGVkUHJvcE5hbWUgaW4gY2hhbmdlLnByb3BlcnR5VXBkYXRlcykge1xuICAgICAgICAgIGNvbnN0IHVwZGF0ZWRQcm9wID0gY2hhbmdlLnByb3BlcnR5VXBkYXRlc1t1cGRhdGVkUHJvcE5hbWVdO1xuICAgICAgICAgIHN3aXRjaCAodXBkYXRlZFByb3BOYW1lKSB7XG4gICAgICAgICAgICBjYXNlICdTb3VyY2UnOlxuICAgICAgICAgICAgICB1cGRhdGVQcm9qZWN0SW5wdXQuc291cmNlID0gdHJhbnNmb3JtT2JqZWN0S2V5cyhcbiAgICAgICAgICAgICAgICBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih1cGRhdGVkUHJvcC5uZXdWYWx1ZSksXG4gICAgICAgICAgICAgICAgY29udmVydFNvdXJjZUNsb3VkZm9ybWF0aW9uS2V5VG9TZGtLZXksXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnRW52aXJvbm1lbnQnOlxuICAgICAgICAgICAgICB1cGRhdGVQcm9qZWN0SW5wdXQuZW52aXJvbm1lbnQgPSBhd2FpdCB0cmFuc2Zvcm1PYmplY3RLZXlzKFxuICAgICAgICAgICAgICAgIGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKHVwZGF0ZWRQcm9wLm5ld1ZhbHVlKSxcbiAgICAgICAgICAgICAgICBsb3dlckNhc2VGaXJzdENoYXJhY3RlcixcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdTb3VyY2VWZXJzaW9uJzpcbiAgICAgICAgICAgICAgdXBkYXRlUHJvamVjdElucHV0LnNvdXJjZVZlcnNpb24gPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih1cGRhdGVkUHJvcC5uZXdWYWx1ZSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHNkay5jb2RlQnVpbGQoKS51cGRhdGVQcm9qZWN0KHVwZGF0ZVByb2plY3RJbnB1dCk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHJldDtcbn1cblxuZnVuY3Rpb24gY29udmVydFNvdXJjZUNsb3VkZm9ybWF0aW9uS2V5VG9TZGtLZXkoa2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgPT09ICdidWlsZHNwZWMnKSB7XG4gICAgcmV0dXJuIGtleS50b0xvd2VyQ2FzZSgpO1xuICB9XG4gIHJldHVybiBsb3dlckNhc2VGaXJzdENoYXJhY3RlcihrZXkpO1xufVxuIl19