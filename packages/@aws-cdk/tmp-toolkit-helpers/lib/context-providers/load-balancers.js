"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoadBalancerListenerContextProviderPlugin = exports.LoadBalancerContextProviderPlugin = void 0;
const cx_api_1 = require("@aws-cdk/cx-api");
const aws_auth_1 = require("../api/aws-auth");
const toolkit_error_1 = require("../api/toolkit-error");
/**
 * Provides load balancer context information.
 */
class LoadBalancerContextProviderPlugin {
    aws;
    constructor(aws) {
        this.aws = aws;
    }
    async getValue(query) {
        if (!query.loadBalancerArn && !query.loadBalancerTags) {
            throw new toolkit_error_1.ContextProviderError('The load balancer lookup query must specify either `loadBalancerArn` or `loadBalancerTags`');
        }
        const loadBalancer = await (await LoadBalancerProvider.getClient(this.aws, query)).getLoadBalancer();
        const ipAddressType = loadBalancer.IpAddressType === 'ipv4' ? cx_api_1.LoadBalancerIpAddressType.IPV4 : cx_api_1.LoadBalancerIpAddressType.DUAL_STACK;
        return {
            loadBalancerArn: loadBalancer.LoadBalancerArn,
            loadBalancerCanonicalHostedZoneId: loadBalancer.CanonicalHostedZoneId,
            loadBalancerDnsName: loadBalancer.DNSName,
            vpcId: loadBalancer.VpcId,
            securityGroupIds: loadBalancer.SecurityGroups ?? [],
            ipAddressType: ipAddressType,
        };
    }
}
exports.LoadBalancerContextProviderPlugin = LoadBalancerContextProviderPlugin;
/**
 * Provides load balancer listener context information
 */
class LoadBalancerListenerContextProviderPlugin {
    aws;
    constructor(aws) {
        this.aws = aws;
    }
    async getValue(query) {
        if (!query.listenerArn && !query.loadBalancerArn && !query.loadBalancerTags) {
            throw new toolkit_error_1.ContextProviderError('The load balancer listener query must specify at least one of: `listenerArn`, `loadBalancerArn` or `loadBalancerTags`');
        }
        return (await LoadBalancerProvider.getClient(this.aws, query)).getListener();
    }
}
exports.LoadBalancerListenerContextProviderPlugin = LoadBalancerListenerContextProviderPlugin;
class LoadBalancerProvider {
    client;
    filter;
    listener;
    static async getClient(aws, query) {
        const client = (await (0, aws_auth_1.initContextProviderSdk)(aws, query)).elbv2();
        try {
            const listener = query.listenerArn
                ? // Assert we're sure there's at least one so it throws if not
                    (await client.describeListeners({ ListenerArns: [query.listenerArn] })).Listeners[0]
                : undefined;
            return new LoadBalancerProvider(client, { ...query, loadBalancerArn: listener?.LoadBalancerArn || query.loadBalancerArn }, listener);
        }
        catch (err) {
            throw new toolkit_error_1.ContextProviderError(`No load balancer listeners found matching arn ${query.listenerArn}`);
        }
    }
    constructor(client, filter, listener) {
        this.client = client;
        this.filter = filter;
        this.listener = listener;
    }
    async getLoadBalancer() {
        const loadBalancers = await this.getLoadBalancers();
        if (loadBalancers.length === 0) {
            throw new toolkit_error_1.ContextProviderError(`No load balancers found matching ${JSON.stringify(this.filter)}`);
        }
        if (loadBalancers.length > 1) {
            throw new toolkit_error_1.ContextProviderError(`Multiple load balancers found matching ${JSON.stringify(this.filter)} - please provide more specific criteria`);
        }
        return loadBalancers[0];
    }
    async getListener() {
        if (this.listener) {
            try {
                const loadBalancer = await this.getLoadBalancer();
                return {
                    listenerArn: this.listener.ListenerArn,
                    listenerPort: this.listener.Port,
                    securityGroupIds: loadBalancer.SecurityGroups || [],
                };
            }
            catch (err) {
                throw new toolkit_error_1.ContextProviderError(`No associated load balancer found for listener arn ${this.filter.listenerArn}`);
            }
        }
        const loadBalancers = await this.getLoadBalancers();
        if (loadBalancers.length === 0) {
            throw new toolkit_error_1.ContextProviderError(`No associated load balancers found for load balancer listener query ${JSON.stringify(this.filter)}`);
        }
        const listeners = (await this.getListenersForLoadBalancers(loadBalancers)).filter((listener) => {
            return ((!this.filter.listenerPort || listener.Port === this.filter.listenerPort) &&
                (!this.filter.listenerProtocol || listener.Protocol === this.filter.listenerProtocol));
        });
        if (listeners.length === 0) {
            throw new toolkit_error_1.ContextProviderError(`No load balancer listeners found matching ${JSON.stringify(this.filter)}`);
        }
        if (listeners.length > 1) {
            throw new toolkit_error_1.ContextProviderError(`Multiple load balancer listeners found matching ${JSON.stringify(this.filter)} - please provide more specific criteria`);
        }
        return {
            listenerArn: listeners[0].ListenerArn,
            listenerPort: listeners[0].Port,
            securityGroupIds: loadBalancers.find((lb) => listeners[0].LoadBalancerArn === lb.LoadBalancerArn)?.SecurityGroups || [],
        };
    }
    async getLoadBalancers() {
        const loadBalancerArns = this.filter.loadBalancerArn ? [this.filter.loadBalancerArn] : undefined;
        const loadBalancers = (await this.client.paginateDescribeLoadBalancers({
            LoadBalancerArns: loadBalancerArns,
        })).filter((lb) => lb.Type === this.filter.loadBalancerType);
        return this.filterByTags(loadBalancers);
    }
    async filterByTags(loadBalancers) {
        if (!this.filter.loadBalancerTags) {
            return loadBalancers;
        }
        return (await this.describeTags(loadBalancers.map((lb) => lb.LoadBalancerArn)))
            .filter((tagDescription) => {
            // For every tag in the filter, there is some tag in the LB that matches it.
            // In other words, the set of tags in the filter is a subset of the set of tags in the LB.
            return this.filter.loadBalancerTags.every((filter) => {
                return tagDescription.Tags?.some((tag) => filter.key === tag.Key && filter.value === tag.Value);
            });
        })
            .flatMap((tag) => loadBalancers.filter((loadBalancer) => tag.ResourceArn === loadBalancer.LoadBalancerArn));
    }
    /**
     * Returns tag descriptions associated with the resources. The API doesn't support
     * pagination, so this function breaks the resource list into chunks and issues
     * the appropriate requests.
     */
    async describeTags(resourceArns) {
        // Max of 20 resource arns per request.
        const chunkSize = 20;
        const tags = Array();
        for (let i = 0; i < resourceArns.length; i += chunkSize) {
            const chunk = resourceArns.slice(i, Math.min(i + chunkSize, resourceArns.length));
            const chunkTags = await this.client.describeTags({
                ResourceArns: chunk,
            });
            tags.push(...(chunkTags.TagDescriptions || []));
        }
        return tags;
    }
    async getListenersForLoadBalancers(loadBalancers) {
        const listeners = [];
        for (const loadBalancer of loadBalancers.map((lb) => lb.LoadBalancerArn)) {
            listeners.push(...(await this.client.paginateDescribeListeners({ LoadBalancerArn: loadBalancer })));
        }
        return listeners;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9hZC1iYWxhbmNlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvY29udGV4dC1wcm92aWRlcnMvbG9hZC1iYWxhbmNlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBS0EsNENBRXlCO0FBR3pCLDhDQUF5RDtBQUV6RCx3REFBNEQ7QUFFNUQ7O0dBRUc7QUFDSCxNQUFhLGlDQUFpQztJQUNmO0lBQTdCLFlBQTZCLEdBQWdCO1FBQWhCLFFBQUcsR0FBSCxHQUFHLENBQWE7SUFDN0MsQ0FBQztJQUVELEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBK0I7UUFDNUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLElBQUksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUN0RCxNQUFNLElBQUksb0NBQW9CLENBQUMsNEZBQTRGLENBQUMsQ0FBQztRQUMvSCxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDLE1BQU0sb0JBQW9CLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUVyRyxNQUFNLGFBQWEsR0FDakIsWUFBWSxDQUFDLGFBQWEsS0FBSyxNQUFNLENBQUMsQ0FBQyxDQUFDLGtDQUF5QixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsa0NBQXlCLENBQUMsVUFBVSxDQUFDO1FBRWhILE9BQU87WUFDTCxlQUFlLEVBQUUsWUFBWSxDQUFDLGVBQWdCO1lBQzlDLGlDQUFpQyxFQUFFLFlBQVksQ0FBQyxxQkFBc0I7WUFDdEUsbUJBQW1CLEVBQUUsWUFBWSxDQUFDLE9BQVE7WUFDMUMsS0FBSyxFQUFFLFlBQVksQ0FBQyxLQUFNO1lBQzFCLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxjQUFjLElBQUksRUFBRTtZQUNuRCxhQUFhLEVBQUUsYUFBYTtTQUM3QixDQUFDO0lBQ0osQ0FBQztDQUNGO0FBdkJELDhFQXVCQztBQUVE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LFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQ2xGLE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUM7Z0JBQy9DLFlBQVksRUFBRSxLQUFLO2FBQ3BCLENBQUMsQ0FBQztZQUVILElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxlQUFlLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztRQUNsRCxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRU8sS0FBSyxDQUFDLDRCQUE0QixDQUFDLGFBQTZCO1FBQ3RFLE1BQU0sU0FBUyxHQUFlLEVBQUUsQ0FBQztRQUNqQyxLQUFLLE1BQU0sWUFBWSxJQUFJLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEVBQUUsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDO1lBQ3pFLFNBQVMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyx5QkFBeUIsQ0FBQyxFQUFFLGVBQWUsRUFBRSxZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN0RyxDQUFDO1FBQ0QsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBMb2FkQmFsYW5jZXJDb250ZXh0UXVlcnksIExvYWRCYWxhbmNlckxpc3RlbmVyQ29udGV4dFF1ZXJ5IH0gZnJvbSAnQGF3cy1jZGsvY2xvdWQtYXNzZW1ibHktc2NoZW1hJztcbmltcG9ydCB0eXBlIHtcbiAgTG9hZEJhbGFuY2VyQ29udGV4dFJlc3BvbnNlLFxuICBMb2FkQmFsYW5jZXJMaXN0ZW5lckNvbnRleHRSZXNwb25zZSxcbn0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB7XG4gIExvYWRCYWxhbmNlcklwQWRkcmVzc1R5cGUsXG59IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgdHlwZSB7IExvYWRCYWxhbmNlciwgTGlzdGVuZXIsIFRhZ0Rlc2NyaXB0aW9uIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWVsYXN0aWMtbG9hZC1iYWxhbmNpbmctdjInO1xuaW1wb3J0IHR5cGUgeyBJRWxhc3RpY0xvYWRCYWxhbmNpbmdWMkNsaWVudCwgU2RrUHJvdmlkZXIgfSBmcm9tICcuLi9hcGkvYXdzLWF1dGgnO1xuaW1wb3J0IHsgaW5pdENvbnRleHRQcm92aWRlclNkayB9IGZyb20gJy4uL2FwaS9hd3MtYXV0aCc7XG5pbXBvcnQgdHlwZSB7IENvbnRleHRQcm92aWRlclBsdWdpbiB9IGZyb20gJy4uL2FwaS9wbHVnaW4nO1xuaW1wb3J0IHsgQ29udGV4dFByb3ZpZGVyRXJyb3IgfSBmcm9tICcuLi9hcGkvdG9vbGtpdC1lcnJvcic7XG5cbi8qKlxuICogUHJvdmlkZXMgbG9hZCBiYWxhbmNlciBjb250ZXh0IGluZm9ybWF0aW9uLlxuICovXG5leHBvcnQgY2xhc3MgTG9hZEJhbGFuY2VyQ29udGV4dFByb3ZpZGVyUGx1Z2luIGltcGxlbWVudHMgQ29udGV4dFByb3ZpZGVyUGx1Z2luIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhd3M6IFNka1Byb3ZpZGVyKSB7XG4gIH1cblxuICBhc3luYyBnZXRWYWx1ZShxdWVyeTogTG9hZEJhbGFuY2VyQ29udGV4dFF1ZXJ5KTogUHJvbWlzZTxMb2FkQmFsYW5jZXJDb250ZXh0UmVzcG9uc2U+IHtcbiAgICBpZiAoIXF1ZXJ5LmxvYWRCYWxhbmNlckFybiAmJiAhcXVlcnkubG9hZEJhbGFuY2VyVGFncykge1xuICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKCdUaGUgbG9hZCBiYWxhbmNlciBsb29rdXAgcXVlcnkgbXVzdCBzcGVjaWZ5IGVpdGhlciBgbG9hZEJhbGFuY2VyQXJuYCBvciBgbG9hZEJhbGFuY2VyVGFnc2AnKTtcbiAgICB9XG5cbiAgICBjb25zdCBsb2FkQmFsYW5jZXIgPSBhd2FpdCAoYXdhaXQgTG9hZEJhbGFuY2VyUHJvdmlkZXIuZ2V0Q2xpZW50KHRoaXMuYXdzLCBxdWVyeSkpLmdldExvYWRCYWxhbmNlcigpO1xuXG4gICAgY29uc3QgaXBBZGRyZXNzVHlwZSA9XG4gICAgICBsb2FkQmFsYW5jZXIuSXBBZGRyZXNzVHlwZSA9PT0gJ2lwdjQnID8gTG9hZEJhbGFuY2VySXBBZGRyZXNzVHlwZS5JUFY0IDogTG9hZEJhbGFuY2VySXBBZGRyZXNzVHlwZS5EVUFMX1NUQUNLO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGxvYWRCYWxhbmNlckFybjogbG9hZEJhbGFuY2VyLkxvYWRCYWxhbmNlckFybiEsXG4gICAgICBsb2FkQmFsYW5jZXJDYW5vbmljYWxIb3N0ZWRab25lSWQ6IGxvYWRCYWxhbmNlci5DYW5vbmljYWxIb3N0ZWRab25lSWQhLFxuICAgICAgbG9hZEJhbGFuY2VyRG5zTmFtZTogbG9hZEJhbGFuY2VyLkROU05hbWUhLFxuICAgICAgdnBjSWQ6IGxvYWRCYWxhbmNlci5WcGNJZCEsXG4gICAgICBzZWN1cml0eUdyb3VwSWRzOiBsb2FkQmFsYW5jZXIuU2VjdXJpdHlHcm91cHMgPz8gW10sXG4gICAgICBpcEFkZHJlc3NUeXBlOiBpcEFkZHJlc3NUeXBlLFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBQcm92aWRlcyBsb2FkIGJhbGFuY2VyIGxpc3RlbmVyIGNvbnRleHQgaW5mb3JtYXRpb25cbiAqL1xuZXhwb3J0IGNsYXNzIExvYWRCYWxhbmNlckxpc3RlbmVyQ29udGV4dFByb3ZpZGVyUGx1Z2luIGltcGxlbWVudHMgQ29udGV4dFByb3ZpZGVyUGx1Z2luIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhd3M6IFNka1Byb3ZpZGVyKSB7XG4gIH1cblxuICBhc3luYyBnZXRWYWx1ZShxdWVyeTogTG9hZEJhbGFuY2VyTGlzdGVuZXJDb250ZXh0UXVlcnkpOiBQcm9taXNlPExvYWRCYWxhbmNlckxpc3RlbmVyQ29udGV4dFJlc3BvbnNlPiB7XG4gICAgaWYgKCFxdWVyeS5saXN0ZW5lckFybiAmJiAhcXVlcnkubG9hZEJhbGFuY2VyQXJuICYmICFxdWVyeS5sb2FkQmFsYW5jZXJUYWdzKSB7XG4gICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoXG4gICAgICAgICdUaGUgbG9hZCBiYWxhbmNlciBsaXN0ZW5lciBxdWVyeSBtdXN0IHNwZWNpZnkgYXQgbGVhc3Qgb25lIG9mOiBgbGlzdGVuZXJBcm5gLCBgbG9hZEJhbGFuY2VyQXJuYCBvciBgbG9hZEJhbGFuY2VyVGFnc2AnLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gKGF3YWl0IExvYWRCYWxhbmNlclByb3ZpZGVyLmdldENsaWVudCh0aGlzLmF3cywgcXVlcnkpKS5nZXRMaXN0ZW5lcigpO1xuICB9XG59XG5cbmNsYXNzIExvYWRCYWxhbmNlclByb3ZpZGVyIHtcbiAgcHVibGljIHN0YXRpYyBhc3luYyBnZXRDbGllbnQoXG4gICAgYXdzOiBTZGtQcm92aWRlcixcbiAgICBxdWVyeTogTG9hZEJhbGFuY2VyTGlzdGVuZXJDb250ZXh0UXVlcnksXG4gICk6IFByb21pc2U8TG9hZEJhbGFuY2VyUHJvdmlkZXI+IHtcbiAgICBjb25zdCBjbGllbnQgPSAoYXdhaXQgaW5pdENvbnRleHRQcm92aWRlclNkayhhd3MsIHF1ZXJ5KSkuZWxidjIoKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBsaXN0ZW5lciA9IHF1ZXJ5Lmxpc3RlbmVyQXJuXG4gICAgICAgID8gLy8gQXNzZXJ0IHdlJ3JlIHN1cmUgdGhlcmUncyBhdCBsZWFzdCBvbmUgc28gaXQgdGhyb3dzIGlmIG5vdFxuICAgICAgICAoYXdhaXQgY2xpZW50LmRlc2NyaWJlTGlzdGVuZXJzKHsgTGlzdGVuZXJBcm5zOiBbcXVlcnkubGlzdGVuZXJBcm5dIH0pKS5MaXN0ZW5lcnMhWzBdIVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiBuZXcgTG9hZEJhbGFuY2VyUHJvdmlkZXIoXG4gICAgICAgIGNsaWVudCxcbiAgICAgICAgeyAuLi5xdWVyeSwgbG9hZEJhbGFuY2VyQXJuOiBsaXN0ZW5lcj8uTG9hZEJhbGFuY2VyQXJuIHx8IHF1ZXJ5LmxvYWRCYWxhbmNlckFybiB9LFxuICAgICAgICBsaXN0ZW5lcixcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoYE5vIGxvYWQgYmFsYW5jZXIgbGlzdGVuZXJzIGZvdW5kIG1hdGNoaW5nIGFybiAke3F1ZXJ5Lmxpc3RlbmVyQXJufWApO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY2xpZW50OiBJRWxhc3RpY0xvYWRCYWxhbmNpbmdWMkNsaWVudCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGZpbHRlcjogTG9hZEJhbGFuY2VyTGlzdGVuZXJDb250ZXh0UXVlcnksXG4gICAgcHJpdmF0ZSByZWFkb25seSBsaXN0ZW5lcj86IExpc3RlbmVyLFxuICApIHtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBnZXRMb2FkQmFsYW5jZXIoKTogUHJvbWlzZTxMb2FkQmFsYW5jZXI+IHtcbiAgICBjb25zdCBsb2FkQmFsYW5jZXJzID0gYXdhaXQgdGhpcy5nZXRMb2FkQmFsYW5jZXJzKCk7XG5cbiAgICBpZiAobG9hZEJhbGFuY2Vycy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBDb250ZXh0UHJvdmlkZXJFcnJvcihgTm8gbG9hZCBiYWxhbmNlcnMgZm91bmQgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeSh0aGlzLmZpbHRlcil9YCk7XG4gICAgfVxuXG4gICAgaWYgKGxvYWRCYWxhbmNlcnMubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKFxuICAgICAgICBgTXVsdGlwbGUgbG9hZCBiYWxhbmNlcnMgZm91bmQgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeSh0aGlzLmZpbHRlcil9IC0gcGxlYXNlIHByb3ZpZGUgbW9yZSBzcGVjaWZpYyBjcml0ZXJpYWAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBsb2FkQmFsYW5jZXJzWzBdO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGdldExpc3RlbmVyKCk6IFByb21pc2U8TG9hZEJhbGFuY2VyTGlzdGVuZXJDb250ZXh0UmVzcG9uc2U+IHtcbiAgICBpZiAodGhpcy5saXN0ZW5lcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbG9hZEJhbGFuY2VyID0gYXdhaXQgdGhpcy5nZXRMb2FkQmFsYW5jZXIoKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBsaXN0ZW5lckFybjogdGhpcy5saXN0ZW5lci5MaXN0ZW5lckFybiEsXG4gICAgICAgICAgbGlzdGVuZXJQb3J0OiB0aGlzLmxpc3RlbmVyLlBvcnQhLFxuICAgICAgICAgIHNlY3VyaXR5R3JvdXBJZHM6IGxvYWRCYWxhbmNlci5TZWN1cml0eUdyb3VwcyB8fCBbXSxcbiAgICAgICAgfTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoYE5vIGFzc29jaWF0ZWQgbG9hZCBiYWxhbmNlciBmb3VuZCBmb3IgbGlzdGVuZXIgYXJuICR7dGhpcy5maWx0ZXIubGlzdGVuZXJBcm59YCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbG9hZEJhbGFuY2VycyA9IGF3YWl0IHRoaXMuZ2V0TG9hZEJhbGFuY2VycygpO1xuICAgIGlmIChsb2FkQmFsYW5jZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKFxuICAgICAgICBgTm8gYXNzb2NpYXRlZCBsb2FkIGJhbGFuY2VycyBmb3VuZCBmb3IgbG9hZCBiYWxhbmNlciBsaXN0ZW5lciBxdWVyeSAke0pTT04uc3RyaW5naWZ5KHRoaXMuZmlsdGVyKX1gLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBsaXN0ZW5lcnMgPSAoYXdhaXQgdGhpcy5nZXRMaXN0ZW5lcnNGb3JMb2FkQmFsYW5jZXJzKGxvYWRCYWxhbmNlcnMpKS5maWx0ZXIoKGxpc3RlbmVyKSA9PiB7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAoIXRoaXMuZmlsdGVyLmxpc3RlbmVyUG9ydCB8fCBsaXN0ZW5lci5Qb3J0ID09PSB0aGlzLmZpbHRlci5saXN0ZW5lclBvcnQpICYmXG4gICAgICAgICghdGhpcy5maWx0ZXIubGlzdGVuZXJQcm90b2NvbCB8fCBsaXN0ZW5lci5Qcm90b2NvbCA9PT0gdGhpcy5maWx0ZXIubGlzdGVuZXJQcm90b2NvbClcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpZiAobGlzdGVuZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKGBObyBsb2FkIGJhbGFuY2VyIGxpc3RlbmVycyBmb3VuZCBtYXRjaGluZyAke0pTT04uc3RyaW5naWZ5KHRoaXMuZmlsdGVyKX1gKTtcbiAgICB9XG5cbiAgICBpZiAobGlzdGVuZXJzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBDb250ZXh0UHJvdmlkZXJFcnJvcihcbiAgICAgICAgYE11bHRpcGxlIGxvYWQgYmFsYW5jZXIgbGlzdGVuZXJzIGZvdW5kIG1hdGNoaW5nICR7SlNPTi5zdHJpbmdpZnkodGhpcy5maWx0ZXIpfSAtIHBsZWFzZSBwcm92aWRlIG1vcmUgc3BlY2lmaWMgY3JpdGVyaWFgLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgbGlzdGVuZXJBcm46IGxpc3RlbmVyc1swXS5MaXN0ZW5lckFybiEsXG4gICAgICBsaXN0ZW5lclBvcnQ6IGxpc3RlbmVyc1swXS5Qb3J0ISxcbiAgICAgIHNlY3VyaXR5R3JvdXBJZHM6XG4gICAgICAgIGxvYWRCYWxhbmNlcnMuZmluZCgobGIpID0+IGxpc3RlbmVyc1swXS5Mb2FkQmFsYW5jZXJBcm4gPT09IGxiLkxvYWRCYWxhbmNlckFybik/LlNlY3VyaXR5R3JvdXBzIHx8IFtdLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldExvYWRCYWxhbmNlcnMoKSB7XG4gICAgY29uc3QgbG9hZEJhbGFuY2VyQXJucyA9IHRoaXMuZmlsdGVyLmxvYWRCYWxhbmNlckFybiA/IFt0aGlzLmZpbHRlci5sb2FkQmFsYW5jZXJBcm5dIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGxvYWRCYWxhbmNlcnMgPSAoXG4gICAgICBhd2FpdCB0aGlzLmNsaWVudC5wYWdpbmF0ZURlc2NyaWJlTG9hZEJhbGFuY2Vycyh7XG4gICAgICAgIExvYWRCYWxhbmNlckFybnM6IGxvYWRCYWxhbmNlckFybnMsXG4gICAgICB9KVxuICAgICkuZmlsdGVyKChsYikgPT4gbGIuVHlwZSA9PT0gdGhpcy5maWx0ZXIubG9hZEJhbGFuY2VyVHlwZSk7XG5cbiAgICByZXR1cm4gdGhpcy5maWx0ZXJCeVRhZ3MobG9hZEJhbGFuY2Vycyk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZpbHRlckJ5VGFncyhsb2FkQmFsYW5jZXJzOiBMb2FkQmFsYW5jZXJbXSk6IFByb21pc2U8TG9hZEJhbGFuY2VyW10+IHtcbiAgICBpZiAoIXRoaXMuZmlsdGVyLmxvYWRCYWxhbmNlclRhZ3MpIHtcbiAgICAgIHJldHVybiBsb2FkQmFsYW5jZXJzO1xuICAgIH1cbiAgICByZXR1cm4gKGF3YWl0IHRoaXMuZGVzY3JpYmVUYWdzKGxvYWRCYWxhbmNlcnMubWFwKChsYikgPT4gbGIuTG9hZEJhbGFuY2VyQXJuISkpKVxuICAgICAgLmZpbHRlcigodGFnRGVzY3JpcHRpb24pID0+IHtcbiAgICAgICAgLy8gRm9yIGV2ZXJ5IHRhZyBpbiB0aGUgZmlsdGVyLCB0aGVyZSBpcyBzb21lIHRhZyBpbiB0aGUgTEIgdGhhdCBtYXRjaGVzIGl0LlxuICAgICAgICAvLyBJbiBvdGhlciB3b3JkcywgdGhlIHNldCBvZiB0YWdzIGluIHRoZSBmaWx0ZXIgaXMgYSBzdWJzZXQgb2YgdGhlIHNldCBvZiB0YWdzIGluIHRoZSBMQi5cbiAgICAgICAgcmV0dXJuIHRoaXMuZmlsdGVyLmxvYWRCYWxhbmNlclRhZ3MhLmV2ZXJ5KChmaWx0ZXIpID0+IHtcbiAgICAgICAgICByZXR1cm4gdGFnRGVzY3JpcHRpb24uVGFncz8uc29tZSgodGFnKSA9PlxuICAgICAgICAgICAgZmlsdGVyLmtleSA9PT0gdGFnLktleSAmJiBmaWx0ZXIudmFsdWUgPT09IHRhZy5WYWx1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC5mbGF0TWFwKCh0YWcpID0+IGxvYWRCYWxhbmNlcnMuZmlsdGVyKChsb2FkQmFsYW5jZXIpID0+IHRhZy5SZXNvdXJjZUFybiA9PT0gbG9hZEJhbGFuY2VyLkxvYWRCYWxhbmNlckFybikpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGFnIGRlc2NyaXB0aW9ucyBhc3NvY2lhdGVkIHdpdGggdGhlIHJlc291cmNlcy4gVGhlIEFQSSBkb2Vzbid0IHN1cHBvcnRcbiAgICogcGFnaW5hdGlvbiwgc28gdGhpcyBmdW5jdGlvbiBicmVha3MgdGhlIHJlc291cmNlIGxpc3QgaW50byBjaHVua3MgYW5kIGlzc3Vlc1xuICAgKiB0aGUgYXBwcm9wcmlhdGUgcmVxdWVzdHMuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGRlc2NyaWJlVGFncyhyZXNvdXJjZUFybnM6IHN0cmluZ1tdKTogUHJvbWlzZTxUYWdEZXNjcmlwdGlvbltdPiB7XG4gICAgLy8gTWF4IG9mIDIwIHJlc291cmNlIGFybnMgcGVyIHJlcXVlc3QuXG4gICAgY29uc3QgY2h1bmtTaXplID0gMjA7XG4gICAgY29uc3QgdGFncyA9IEFycmF5PFRhZ0Rlc2NyaXB0aW9uPigpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzb3VyY2VBcm5zLmxlbmd0aDsgaSArPSBjaHVua1NpemUpIHtcbiAgICAgIGNvbnN0IGNodW5rID0gcmVzb3VyY2VBcm5zLnNsaWNlKGksIE1hdGgubWluKGkgKyBjaHVua1NpemUsIHJlc291cmNlQXJucy5sZW5ndGgpKTtcbiAgICAgIGNvbnN0IGNodW5rVGFncyA9IGF3YWl0IHRoaXMuY2xpZW50LmRlc2NyaWJlVGFncyh7XG4gICAgICAgIFJlc291cmNlQXJuczogY2h1bmssXG4gICAgICB9KTtcblxuICAgICAgdGFncy5wdXNoKC4uLihjaHVua1RhZ3MuVGFnRGVzY3JpcHRpb25zIHx8IFtdKSk7XG4gICAgfVxuICAgIHJldHVybiB0YWdzO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRMaXN0ZW5lcnNGb3JMb2FkQmFsYW5jZXJzKGxvYWRCYWxhbmNlcnM6IExvYWRCYWxhbmNlcltdKTogUHJvbWlzZTxMaXN0ZW5lcltdPiB7XG4gICAgY29uc3QgbGlzdGVuZXJzOiBMaXN0ZW5lcltdID0gW107XG4gICAgZm9yIChjb25zdCBsb2FkQmFsYW5jZXIgb2YgbG9hZEJhbGFuY2Vycy5tYXAoKGxiKSA9PiBsYi5Mb2FkQmFsYW5jZXJBcm4pKSB7XG4gICAgICBsaXN0ZW5lcnMucHVzaCguLi4oYXdhaXQgdGhpcy5jbGllbnQucGFnaW5hdGVEZXNjcmliZUxpc3RlbmVycyh7IExvYWRCYWxhbmNlckFybjogbG9hZEJhbGFuY2VyIH0pKSk7XG4gICAgfVxuICAgIHJldHVybiBsaXN0ZW5lcnM7XG4gIH1cbn1cbiJdfQ==