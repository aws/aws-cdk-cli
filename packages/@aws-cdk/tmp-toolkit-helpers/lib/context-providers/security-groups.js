"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityGroupContextProviderPlugin = void 0;
exports.hasAllTrafficEgress = hasAllTrafficEgress;
const aws_auth_1 = require("../api/aws-auth");
const toolkit_error_1 = require("../api/toolkit-error");
class SecurityGroupContextProviderPlugin {
    aws;
    constructor(aws) {
        this.aws = aws;
    }
    async getValue(args) {
        if (args.securityGroupId && args.securityGroupName) {
            throw new toolkit_error_1.ContextProviderError("'securityGroupId' and 'securityGroupName' can not be specified both when looking up a security group");
        }
        if (!args.securityGroupId && !args.securityGroupName) {
            throw new toolkit_error_1.ContextProviderError("'securityGroupId' or 'securityGroupName' must be specified to look up a security group");
        }
        const ec2 = (await (0, aws_auth_1.initContextProviderSdk)(this.aws, args)).ec2();
        const filters = [];
        if (args.vpcId) {
            filters.push({
                Name: 'vpc-id',
                Values: [args.vpcId],
            });
        }
        if (args.securityGroupName) {
            filters.push({
                Name: 'group-name',
                Values: [args.securityGroupName],
            });
        }
        const response = await ec2.describeSecurityGroups({
            GroupIds: args.securityGroupId ? [args.securityGroupId] : undefined,
            Filters: filters.length > 0 ? filters : undefined,
        });
        const securityGroups = response.SecurityGroups ?? [];
        if (securityGroups.length === 0) {
            throw new toolkit_error_1.ContextProviderError(`No security groups found matching ${JSON.stringify(args)}`);
        }
        if (securityGroups.length > 1) {
            throw new toolkit_error_1.ContextProviderError(`More than one security groups found matching ${JSON.stringify(args)}`);
        }
        const [securityGroup] = securityGroups;
        return {
            securityGroupId: securityGroup.GroupId,
            allowAllOutbound: hasAllTrafficEgress(securityGroup),
        };
    }
}
exports.SecurityGroupContextProviderPlugin = SecurityGroupContextProviderPlugin;
/**
 * @internal
 */
function hasAllTrafficEgress(securityGroup) {
    let hasAllTrafficCidrV4 = false;
    let hasAllTrafficCidrV6 = false;
    for (const ipPermission of securityGroup.IpPermissionsEgress ?? []) {
        const isAllProtocols = ipPermission.IpProtocol === '-1';
        if (isAllProtocols && ipPermission.IpRanges?.some((m) => m.CidrIp === '0.0.0.0/0')) {
            hasAllTrafficCidrV4 = true;
        }
        if (isAllProtocols && ipPermission.Ipv6Ranges?.some((m) => m.CidrIpv6 === '::/0')) {
            hasAllTrafficCidrV6 = true;
        }
    }
    return hasAllTrafficCidrV4 && hasAllTrafficCidrV6;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJpdHktZ3JvdXBzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2NvbnRleHQtcHJvdmlkZXJzL3NlY3VyaXR5LWdyb3Vwcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFnRUEsa0RBaUJDO0FBOUVELDhDQUEyRTtBQUUzRSx3REFBNEQ7QUFFNUQsTUFBYSxrQ0FBa0M7SUFDaEI7SUFBN0IsWUFBNkIsR0FBZ0I7UUFBaEIsUUFBRyxHQUFILEdBQUcsQ0FBYTtJQUM3QyxDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUErQjtRQUM1QyxJQUFJLElBQUksQ0FBQyxlQUFlLElBQUksSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDbkQsTUFBTSxJQUFJLG9DQUFvQixDQUM1QixzR0FBc0csQ0FDdkcsQ0FBQztRQUNKLENBQUM7UUFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsSUFBSSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3JELE1BQU0sSUFBSSxvQ0FBb0IsQ0FBQyx3RkFBd0YsQ0FBQyxDQUFDO1FBQzNILENBQUM7UUFFRCxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sSUFBQSxpQ0FBc0IsRUFBQyxJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7UUFFakUsTUFBTSxPQUFPLEdBQWEsRUFBRSxDQUFDO1FBQzdCLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLElBQUksQ0FBQztnQkFDWCxJQUFJLEVBQUUsUUFBUTtnQkFDZCxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO2FBQ3JCLENBQUMsQ0FBQztRQUNMLENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQzNCLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsSUFBSSxFQUFFLFlBQVk7Z0JBQ2xCLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQzthQUNqQyxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLENBQUMsc0JBQXNCLENBQUM7WUFDaEQsUUFBUSxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQ25FLE9BQU8sRUFBRSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTO1NBQ2xELENBQUMsQ0FBQztRQUVILE1BQU0sY0FBYyxHQUFHLFFBQVEsQ0FBQyxjQUFjLElBQUksRUFBRSxDQUFDO1FBQ3JELElBQUksY0FBYyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNoQyxNQUFNLElBQUksb0NBQW9CLENBQUMscUNBQXFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQzlGLENBQUM7UUFFRCxJQUFJLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDOUIsTUFBTSxJQUFJLG9DQUFvQixDQUFDLGdEQUFnRCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN6RyxDQUFDO1FBRUQsTUFBTSxDQUFDLGFBQWEsQ0FBQyxHQUFHLGNBQWMsQ0FBQztRQUV2QyxPQUFPO1lBQ0wsZUFBZSxFQUFFLGFBQWEsQ0FBQyxPQUFRO1lBQ3ZDLGdCQUFnQixFQUFFLG1CQUFtQixDQUFDLGFBQWEsQ0FBQztTQUNyRCxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBcERELGdGQW9EQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsbUJBQW1CLENBQUMsYUFBNEI7SUFDOUQsSUFBSSxtQkFBbUIsR0FBRyxLQUFLLENBQUM7SUFDaEMsSUFBSSxtQkFBbUIsR0FBRyxLQUFLLENBQUM7SUFFaEMsS0FBSyxNQUFNLFlBQVksSUFBSSxhQUFhLENBQUMsbUJBQW1CLElBQUksRUFBRSxFQUFFLENBQUM7UUFDbkUsTUFBTSxjQUFjLEdBQUcsWUFBWSxDQUFDLFVBQVUsS0FBSyxJQUFJLENBQUM7UUFFeEQsSUFBSSxjQUFjLElBQUksWUFBWSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLEtBQUssV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUNuRixtQkFBbUIsR0FBRyxJQUFJLENBQUM7UUFDN0IsQ0FBQztRQUVELElBQUksY0FBYyxJQUFJLFlBQVksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxLQUFLLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDbEYsbUJBQW1CLEdBQUcsSUFBSSxDQUFDO1FBQzdCLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxtQkFBbUIsSUFBSSxtQkFBbUIsQ0FBQztBQUNwRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBTZWN1cml0eUdyb3VwQ29udGV4dFF1ZXJ5IH0gZnJvbSAnQGF3cy1jZGsvY2xvdWQtYXNzZW1ibHktc2NoZW1hJztcbmltcG9ydCB0eXBlIHsgU2VjdXJpdHlHcm91cENvbnRleHRSZXNwb25zZSB9IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgdHlwZSB7IEZpbHRlciwgU2VjdXJpdHlHcm91cCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1lYzInO1xuaW1wb3J0IHsgdHlwZSBTZGtQcm92aWRlciwgaW5pdENvbnRleHRQcm92aWRlclNkayB9IGZyb20gJy4uL2FwaS9hd3MtYXV0aCc7XG5pbXBvcnQgdHlwZSB7IENvbnRleHRQcm92aWRlclBsdWdpbiB9IGZyb20gJy4uL2FwaS9wbHVnaW4nO1xuaW1wb3J0IHsgQ29udGV4dFByb3ZpZGVyRXJyb3IgfSBmcm9tICcuLi9hcGkvdG9vbGtpdC1lcnJvcic7XG5cbmV4cG9ydCBjbGFzcyBTZWN1cml0eUdyb3VwQ29udGV4dFByb3ZpZGVyUGx1Z2luIGltcGxlbWVudHMgQ29udGV4dFByb3ZpZGVyUGx1Z2luIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhd3M6IFNka1Byb3ZpZGVyKSB7XG4gIH1cblxuICBhc3luYyBnZXRWYWx1ZShhcmdzOiBTZWN1cml0eUdyb3VwQ29udGV4dFF1ZXJ5KTogUHJvbWlzZTxTZWN1cml0eUdyb3VwQ29udGV4dFJlc3BvbnNlPiB7XG4gICAgaWYgKGFyZ3Muc2VjdXJpdHlHcm91cElkICYmIGFyZ3Muc2VjdXJpdHlHcm91cE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBDb250ZXh0UHJvdmlkZXJFcnJvcihcbiAgICAgICAgXCInc2VjdXJpdHlHcm91cElkJyBhbmQgJ3NlY3VyaXR5R3JvdXBOYW1lJyBjYW4gbm90IGJlIHNwZWNpZmllZCBib3RoIHdoZW4gbG9va2luZyB1cCBhIHNlY3VyaXR5IGdyb3VwXCIsXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmICghYXJncy5zZWN1cml0eUdyb3VwSWQgJiYgIWFyZ3Muc2VjdXJpdHlHcm91cE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBDb250ZXh0UHJvdmlkZXJFcnJvcihcIidzZWN1cml0eUdyb3VwSWQnIG9yICdzZWN1cml0eUdyb3VwTmFtZScgbXVzdCBiZSBzcGVjaWZpZWQgdG8gbG9vayB1cCBhIHNlY3VyaXR5IGdyb3VwXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGVjMiA9IChhd2FpdCBpbml0Q29udGV4dFByb3ZpZGVyU2RrKHRoaXMuYXdzLCBhcmdzKSkuZWMyKCk7XG5cbiAgICBjb25zdCBmaWx0ZXJzOiBGaWx0ZXJbXSA9IFtdO1xuICAgIGlmIChhcmdzLnZwY0lkKSB7XG4gICAgICBmaWx0ZXJzLnB1c2goe1xuICAgICAgICBOYW1lOiAndnBjLWlkJyxcbiAgICAgICAgVmFsdWVzOiBbYXJncy52cGNJZF0sXG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGFyZ3Muc2VjdXJpdHlHcm91cE5hbWUpIHtcbiAgICAgIGZpbHRlcnMucHVzaCh7XG4gICAgICAgIE5hbWU6ICdncm91cC1uYW1lJyxcbiAgICAgICAgVmFsdWVzOiBbYXJncy5zZWN1cml0eUdyb3VwTmFtZV0sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGVjMi5kZXNjcmliZVNlY3VyaXR5R3JvdXBzKHtcbiAgICAgIEdyb3VwSWRzOiBhcmdzLnNlY3VyaXR5R3JvdXBJZCA/IFthcmdzLnNlY3VyaXR5R3JvdXBJZF0gOiB1bmRlZmluZWQsXG4gICAgICBGaWx0ZXJzOiBmaWx0ZXJzLmxlbmd0aCA+IDAgPyBmaWx0ZXJzIDogdW5kZWZpbmVkLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2VjdXJpdHlHcm91cHMgPSByZXNwb25zZS5TZWN1cml0eUdyb3VwcyA/PyBbXTtcbiAgICBpZiAoc2VjdXJpdHlHcm91cHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoYE5vIHNlY3VyaXR5IGdyb3VwcyBmb3VuZCBtYXRjaGluZyAke0pTT04uc3RyaW5naWZ5KGFyZ3MpfWApO1xuICAgIH1cblxuICAgIGlmIChzZWN1cml0eUdyb3Vwcy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoYE1vcmUgdGhhbiBvbmUgc2VjdXJpdHkgZ3JvdXBzIGZvdW5kIG1hdGNoaW5nICR7SlNPTi5zdHJpbmdpZnkoYXJncyl9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgW3NlY3VyaXR5R3JvdXBdID0gc2VjdXJpdHlHcm91cHM7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc2VjdXJpdHlHcm91cElkOiBzZWN1cml0eUdyb3VwLkdyb3VwSWQhLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogaGFzQWxsVHJhZmZpY0VncmVzcyhzZWN1cml0eUdyb3VwKSxcbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoYXNBbGxUcmFmZmljRWdyZXNzKHNlY3VyaXR5R3JvdXA6IFNlY3VyaXR5R3JvdXApIHtcbiAgbGV0IGhhc0FsbFRyYWZmaWNDaWRyVjQgPSBmYWxzZTtcbiAgbGV0IGhhc0FsbFRyYWZmaWNDaWRyVjYgPSBmYWxzZTtcblxuICBmb3IgKGNvbnN0IGlwUGVybWlzc2lvbiBvZiBzZWN1cml0eUdyb3VwLklwUGVybWlzc2lvbnNFZ3Jlc3MgPz8gW10pIHtcbiAgICBjb25zdCBpc0FsbFByb3RvY29scyA9IGlwUGVybWlzc2lvbi5JcFByb3RvY29sID09PSAnLTEnO1xuXG4gICAgaWYgKGlzQWxsUHJvdG9jb2xzICYmIGlwUGVybWlzc2lvbi5JcFJhbmdlcz8uc29tZSgobSkgPT4gbS5DaWRySXAgPT09ICcwLjAuMC4wLzAnKSkge1xuICAgICAgaGFzQWxsVHJhZmZpY0NpZHJWNCA9IHRydWU7XG4gICAgfVxuXG4gICAgaWYgKGlzQWxsUHJvdG9jb2xzICYmIGlwUGVybWlzc2lvbi5JcHY2UmFuZ2VzPy5zb21lKChtKSA9PiBtLkNpZHJJcHY2ID09PSAnOjovMCcpKSB7XG4gICAgICBoYXNBbGxUcmFmZmljQ2lkclY2ID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gaGFzQWxsVHJhZmZpY0NpZHJWNCAmJiBoYXNBbGxUcmFmZmljQ2lkclY2O1xufVxuIl19