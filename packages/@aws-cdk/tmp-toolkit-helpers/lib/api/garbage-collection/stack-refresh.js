"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackgroundStackRefresh = exports.ActiveAssetCache = void 0;
exports.refreshStacks = refreshStacks;
const private_1 = require("../io/private");
const toolkit_error_1 = require("../toolkit-error");
class ActiveAssetCache {
    stacks = new Set();
    rememberStack(stackTemplate) {
        this.stacks.add(stackTemplate);
    }
    contains(asset) {
        for (const stack of this.stacks) {
            if (stack.includes(asset)) {
                return true;
            }
        }
        return false;
    }
}
exports.ActiveAssetCache = ActiveAssetCache;
async function paginateSdkCall(cb) {
    let finished = false;
    let nextToken;
    while (!finished) {
        nextToken = await cb(nextToken);
        if (nextToken === undefined) {
            finished = true;
        }
    }
}
/**
 * Fetches all relevant stack templates from CloudFormation. It ignores the following stacks:
 * - stacks in DELETE_COMPLETE or DELETE_IN_PROGRESS stage
 * - stacks that are using a different bootstrap qualifier
 */
async function fetchAllStackTemplates(cfn, ioHelper, qualifier) {
    const stackNames = [];
    await paginateSdkCall(async (nextToken) => {
        const stacks = await cfn.listStacks({ NextToken: nextToken });
        // We ignore stacks with these statuses because their assets are no longer live
        const ignoredStatues = ['CREATE_FAILED', 'DELETE_COMPLETE', 'DELETE_IN_PROGRESS', 'DELETE_FAILED', 'REVIEW_IN_PROGRESS'];
        stackNames.push(...(stacks.StackSummaries ?? [])
            .filter((s) => !ignoredStatues.includes(s.StackStatus))
            .map((s) => s.StackId ?? s.StackName));
        return stacks.NextToken;
    });
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Parsing through ${stackNames.length} stacks`));
    const templates = [];
    for (const stack of stackNames) {
        let summary;
        summary = await cfn.getTemplateSummary({
            StackName: stack,
        });
        if (bootstrapFilter(summary.Parameters, qualifier)) {
            // This stack is definitely bootstrapped to a different qualifier so we can safely ignore it
            continue;
        }
        else {
            const template = await cfn.getTemplate({
                StackName: stack,
            });
            templates.push((template.TemplateBody ?? '') + JSON.stringify(summary?.Parameters));
        }
    }
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg('Done parsing through stacks'));
    return templates;
}
/**
 * Filter out stacks that we KNOW are using a different bootstrap qualifier
 * This is mostly necessary for the integration tests that can run the same app (with the same assets)
 * under different qualifiers.
 * This is necessary because a stack under a different bootstrap could coincidentally reference the same hash
 * and cause a false negative (cause an asset to be preserved when its isolated)
 * This is intentionally done in a way where we ONLY filter out stacks that are meant for a different qualifier
 * because we are okay with false positives.
 */
function bootstrapFilter(parameters, qualifier) {
    const bootstrapVersion = parameters?.find((p) => p.ParameterKey === 'BootstrapVersion');
    const splitBootstrapVersion = bootstrapVersion?.DefaultValue?.split('/');
    // We find the qualifier in a specific part of the bootstrap version parameter
    return (qualifier &&
        splitBootstrapVersion &&
        splitBootstrapVersion.length == 4 &&
        splitBootstrapVersion[2] != qualifier);
}
async function refreshStacks(cfn, ioHelper, activeAssets, qualifier) {
    try {
        const stacks = await fetchAllStackTemplates(cfn, ioHelper, qualifier);
        for (const stack of stacks) {
            activeAssets.rememberStack(stack);
        }
    }
    catch (err) {
        throw new toolkit_error_1.ToolkitError(`Error refreshing stacks: ${err}`);
    }
}
/**
 * Class that controls scheduling of the background stack refresh
 */
class BackgroundStackRefresh {
    props;
    timeout;
    lastRefreshTime;
    queuedPromises = [];
    constructor(props) {
        this.props = props;
        this.lastRefreshTime = Date.now();
    }
    start() {
        // Since start is going to be called right after the first invocation of refreshStacks,
        // lets wait some time before beginning the background refresh.
        this.timeout = setTimeout(() => this.refresh(), 300_000); // 5 minutes
    }
    async refresh() {
        const startTime = Date.now();
        await refreshStacks(this.props.cfn, this.props.ioHelper, this.props.activeAssets, this.props.qualifier);
        this.justRefreshedStacks();
        // If the last invocation of refreshStacks takes <5 minutes, the next invocation starts 5 minutes after the last one started.
        // If the last invocation of refreshStacks takes >5 minutes, the next invocation starts immediately.
        this.timeout = setTimeout(() => this.refresh(), Math.max(startTime + 300_000 - Date.now(), 0));
    }
    justRefreshedStacks() {
        this.lastRefreshTime = Date.now();
        for (const p of this.queuedPromises.splice(0, this.queuedPromises.length)) {
            p(undefined);
        }
    }
    /**
     * Checks if the last successful background refresh happened within the specified time frame.
     * If the last refresh is older than the specified time frame, it returns a Promise that resolves
     * when the next background refresh completes or rejects if the refresh takes too long.
     */
    noOlderThan(ms) {
        const horizon = Date.now() - ms;
        // The last refresh happened within the time frame
        if (this.lastRefreshTime >= horizon) {
            return Promise.resolve();
        }
        // The last refresh happened earlier than the time frame
        // We will wait for the latest refresh to land or reject if it takes too long
        return Promise.race([
            new Promise(resolve => this.queuedPromises.push(resolve)),
            new Promise((_, reject) => setTimeout(() => reject(new toolkit_error_1.ToolkitError('refreshStacks took too long; the background thread likely threw an error')), ms)),
        ]);
    }
    stop() {
        clearTimeout(this.timeout);
    }
}
exports.BackgroundStackRefresh = BackgroundStackRefresh;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stcmVmcmVzaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvZ2FyYmFnZS1jb2xsZWN0aW9uL3N0YWNrLXJlZnJlc2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBbUdBLHNDQVNDO0FBMUdELDJDQUFrRDtBQUNsRCxvREFBZ0Q7QUFFaEQsTUFBYSxnQkFBZ0I7SUFDVixNQUFNLEdBQWdCLElBQUksR0FBRyxFQUFFLENBQUM7SUFFMUMsYUFBYSxDQUFDLGFBQXFCO1FBQ3hDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFTSxRQUFRLENBQUMsS0FBYTtRQUMzQixLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNoQyxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDMUIsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1FBQ0gsQ0FBQztRQUNELE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztDQUNGO0FBZkQsNENBZUM7QUFFRCxLQUFLLFVBQVUsZUFBZSxDQUFDLEVBQXVEO0lBQ3BGLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQztJQUNyQixJQUFJLFNBQTZCLENBQUM7SUFDbEMsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2pCLFNBQVMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNoQyxJQUFJLFNBQVMsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUM1QixRQUFRLEdBQUcsSUFBSSxDQUFDO1FBQ2xCLENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxLQUFLLFVBQVUsc0JBQXNCLENBQUMsR0FBMEIsRUFBRSxRQUFrQixFQUFFLFNBQWtCO0lBQ3RHLE1BQU0sVUFBVSxHQUFhLEVBQUUsQ0FBQztJQUNoQyxNQUFNLGVB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biB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgdHlwZSB7IElDbG91ZEZvcm1hdGlvbkNsaWVudCB9IGZyb20gJy4uL2F3cy1hdXRoJztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcblxuZXhwb3J0IGNsYXNzIEFjdGl2ZUFzc2V0Q2FjaGUge1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YWNrczogU2V0PHN0cmluZz4gPSBuZXcgU2V0KCk7XG5cbiAgcHVibGljIHJlbWVtYmVyU3RhY2soc3RhY2tUZW1wbGF0ZTogc3RyaW5nKSB7XG4gICAgdGhpcy5zdGFja3MuYWRkKHN0YWNrVGVtcGxhdGUpO1xuICB9XG5cbiAgcHVibGljIGNvbnRhaW5zKGFzc2V0OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBmb3IgKGNvbnN0IHN0YWNrIG9mIHRoaXMuc3RhY2tzKSB7XG4gICAgICBpZiAoc3RhY2suaW5jbHVkZXMoYXNzZXQpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcGFnaW5hdGVTZGtDYWxsKGNiOiAobmV4dFRva2VuPzogc3RyaW5nKSA9PiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4pIHtcbiAgbGV0IGZpbmlzaGVkID0gZmFsc2U7XG4gIGxldCBuZXh0VG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgd2hpbGUgKCFmaW5pc2hlZCkge1xuICAgIG5leHRUb2tlbiA9IGF3YWl0IGNiKG5leHRUb2tlbik7XG4gICAgaWYgKG5leHRUb2tlbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBmaW5pc2hlZCA9IHRydWU7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogRmV0Y2hlcyBhbGwgcmVsZXZhbnQgc3RhY2sgdGVtcGxhdGVzIGZyb20gQ2xvdWRGb3JtYXRpb24uIEl0IGlnbm9yZXMgdGhlIGZvbGxvd2luZyBzdGFja3M6XG4gKiAtIHN0YWNrcyBpbiBERUxFVEVfQ09NUExFVEUgb3IgREVMRVRFX0lOX1BST0dSRVNTIHN0YWdlXG4gKiAtIHN0YWNrcyB0aGF0IGFyZSB1c2luZyBhIGRpZmZlcmVudCBib290c3RyYXAgcXVhbGlmaWVyXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWxsU3RhY2tUZW1wbGF0ZXMoY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQsIGlvSGVscGVyOiBJb0hlbHBlciwgcXVhbGlmaWVyPzogc3RyaW5nKSB7XG4gIGNvbnN0IHN0YWNrTmFtZXM6IHN0cmluZ1tdID0gW107XG4gIGF3YWl0IHBhZ2luYXRlU2RrQ2FsbChhc3luYyAobmV4dFRva2VuKSA9PiB7XG4gICAgY29uc3Qgc3RhY2tzID0gYXdhaXQgY2ZuLmxpc3RTdGFja3MoeyBOZXh0VG9rZW46IG5leHRUb2tlbiB9KTtcblxuICAgIC8vIFdlIGlnbm9yZSBzdGFja3Mgd2l0aCB0aGVzZSBzdGF0dXNlcyBiZWNhdXNlIHRoZWlyIGFzc2V0cyBhcmUgbm8gbG9uZ2VyIGxpdmVcbiAgICBjb25zdCBpZ25vcmVkU3RhdHVlcyA9IFsnQ1JFQVRFX0ZBSUxFRCcsICdERUxFVEVfQ09NUExFVEUnLCAnREVMRVRFX0lOX1BST0dSRVNTJywgJ0RFTEVURV9GQUlMRUQnLCAnUkVWSUVXX0lOX1BST0dSRVNTJ107XG4gICAgc3RhY2tOYW1lcy5wdXNoKFxuICAgICAgLi4uKHN0YWNrcy5TdGFja1N1bW1hcmllcyA/PyBbXSlcbiAgICAgICAgLmZpbHRlcigoczogYW55KSA9PiAhaWdub3JlZFN0YXR1ZXMuaW5jbHVkZXMocy5TdGFja1N0YXR1cykpXG4gICAgICAgIC5tYXAoKHM6IGFueSkgPT4gcy5TdGFja0lkID8/IHMuU3RhY2tOYW1lKSxcbiAgICApO1xuXG4gICAgcmV0dXJuIHN0YWNrcy5OZXh0VG9rZW47XG4gIH0pO1xuXG4gIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGBQYXJzaW5nIHRocm91Z2ggJHtzdGFja05hbWVzLmxlbmd0aH0gc3RhY2tzYCkpO1xuXG4gIGNvbnN0IHRlbXBsYXRlczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBzdGFjayBvZiBzdGFja05hbWVzKSB7XG4gICAgbGV0IHN1bW1hcnk7XG4gICAgc3VtbWFyeSA9IGF3YWl0IGNmbi5nZXRUZW1wbGF0ZVN1bW1hcnkoe1xuICAgICAgU3RhY2tOYW1lOiBzdGFjayxcbiAgICB9KTtcblxuICAgIGlmIChib290c3RyYXBGaWx0ZXIoc3VtbWFyeS5QYXJhbWV0ZXJzLCBxdWFsaWZpZXIpKSB7XG4gICAgICAvLyBUaGlzIHN0YWNrIGlzIGRlZmluaXRlbHkgYm9vdHN0cmFwcGVkIHRvIGEgZGlmZmVyZW50IHF1YWxpZmllciBzbyB3ZSBjYW4gc2FmZWx5IGlnbm9yZSBpdFxuICAgICAgY29udGludWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gYXdhaXQgY2ZuLmdldFRlbXBsYXRlKHtcbiAgICAgICAgU3RhY2tOYW1lOiBzdGFjayxcbiAgICAgIH0pO1xuXG4gICAgICB0ZW1wbGF0ZXMucHVzaCgodGVtcGxhdGUuVGVtcGxhdGVCb2R5ID8/ICcnKSArIEpTT04uc3RyaW5naWZ5KHN1bW1hcnk/LlBhcmFtZXRlcnMpKTtcbiAgICB9XG4gIH1cblxuICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZygnRG9uZSBwYXJzaW5nIHRocm91Z2ggc3RhY2tzJykpO1xuXG4gIHJldHVybiB0ZW1wbGF0ZXM7XG59XG5cbi8qKlxuICogRmlsdGVyIG91dCBzdGFja3MgdGhhdCB3ZSBLTk9XIGFyZSB1c2luZyBhIGRpZmZlcmVudCBib290c3RyYXAgcXVhbGlmaWVyXG4gKiBUaGlzIGlzIG1vc3RseSBuZWNlc3NhcnkgZm9yIHRoZSBpbnRlZ3JhdGlvbiB0ZXN0cyB0aGF0IGNhbiBydW4gdGhlIHNhbWUgYXBwICh3aXRoIHRoZSBzYW1lIGFzc2V0cylcbiAqIHVuZGVyIGRpZmZlcmVudCBxdWFsaWZpZXJzLlxuICogVGhpcyBpcyBuZWNlc3NhcnkgYmVjYXVzZSBhIHN0YWNrIHVuZGVyIGEgZGlmZmVyZW50IGJvb3RzdHJhcCBjb3VsZCBjb2luY2lkZW50YWxseSByZWZlcmVuY2UgdGhlIHNhbWUgaGFzaFxuICogYW5kIGNhdXNlIGEgZmFsc2UgbmVnYXRpdmUgKGNhdXNlIGFuIGFzc2V0IHRvIGJlIHByZXNlcnZlZCB3aGVuIGl0cyBpc29sYXRlZClcbiAqIFRoaXMgaXMgaW50ZW50aW9uYWxseSBkb25lIGluIGEgd2F5IHdoZXJlIHdlIE9OTFkgZmlsdGVyIG91dCBzdGFja3MgdGhhdCBhcmUgbWVhbnQgZm9yIGEgZGlmZmVyZW50IHF1YWxpZmllclxuICogYmVjYXVzZSB3ZSBhcmUgb2theSB3aXRoIGZhbHNlIHBvc2l0aXZlcy5cbiAqL1xuZnVuY3Rpb24gYm9vdHN0cmFwRmlsdGVyKHBhcmFtZXRlcnM/OiBQYXJhbWV0ZXJEZWNsYXJhdGlvbltdLCBxdWFsaWZpZXI/OiBzdHJpbmcpIHtcbiAgY29uc3QgYm9vdHN0cmFwVmVyc2lvbiA9IHBhcmFtZXRlcnM/LmZpbmQoKHApID0+IHAuUGFyYW1ldGVyS2V5ID09PSAnQm9vdHN0cmFwVmVyc2lvbicpO1xuICBjb25zdCBzcGxpdEJvb3RzdHJhcFZlcnNpb24gPSBib290c3RyYXBWZXJzaW9uPy5EZWZhdWx0VmFsdWU/LnNwbGl0KCcvJyk7XG4gIC8vIFdlIGZpbmQgdGhlIHF1YWxpZmllciBpbiBhIHNwZWNpZmljIHBhcnQgb2YgdGhlIGJvb3RzdHJhcCB2ZXJzaW9uIHBhcmFtZXRlclxuICByZXR1cm4gKHF1YWxpZmllciAmJlxuICAgICAgICAgIHNwbGl0Qm9vdHN0cmFwVmVyc2lvbiAmJlxuICAgICAgICAgIHNwbGl0Qm9vdHN0cmFwVmVyc2lvbi5sZW5ndGggPT0gNCAmJlxuICAgICAgICAgIHNwbGl0Qm9vdHN0cmFwVmVyc2lvblsyXSAhPSBxdWFsaWZpZXIpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFN0YWNrcyhjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCwgaW9IZWxwZXI6IElvSGVscGVyLCBhY3RpdmVBc3NldHM6IEFjdGl2ZUFzc2V0Q2FjaGUsIHF1YWxpZmllcj86IHN0cmluZykge1xuICB0cnkge1xuICAgIGNvbnN0IHN0YWNrcyA9IGF3YWl0IGZldGNoQWxsU3RhY2tUZW1wbGF0ZXMoY2ZuLCBpb0hlbHBlciwgcXVhbGlmaWVyKTtcbiAgICBmb3IgKGNvbnN0IHN0YWNrIG9mIHN0YWNrcykge1xuICAgICAgYWN0aXZlQXNzZXRzLnJlbWVtYmVyU3RhY2soc3RhY2spO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgRXJyb3IgcmVmcmVzaGluZyBzdGFja3M6ICR7ZXJyfWApO1xuICB9XG59XG5cbi8qKlxuICogQmFja2dyb3VuZCBTdGFjayBSZWZyZXNoIHByb3BlcnRpZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBCYWNrZ3JvdW5kU3RhY2tSZWZyZXNoUHJvcHMge1xuICAvKipcbiAgICogVGhlIENGTiBTREsgaGFuZGxlclxuICAgKi9cbiAgcmVhZG9ubHkgY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQ7XG5cbiAgLyoqXG4gICAqIFVzZWQgdG8gc2VuZCBtZXNzYWdlcy5cbiAgICovXG4gIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcjtcblxuICAvKipcbiAgICogQWN0aXZlIEFzc2V0IHN0b3JhZ2VcbiAgICovXG4gIHJlYWRvbmx5IGFjdGl2ZUFzc2V0czogQWN0aXZlQXNzZXRDYWNoZTtcblxuICAvKipcbiAgICogU3RhY2sgYm9vdHN0cmFwIHF1YWxpZmllclxuICAgKi9cbiAgcmVhZG9ubHkgcXVhbGlmaWVyPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENsYXNzIHRoYXQgY29udHJvbHMgc2NoZWR1bGluZyBvZiB0aGUgYmFja2dyb3VuZCBzdGFjayByZWZyZXNoXG4gKi9cbmV4cG9ydCBjbGFzcyBCYWNrZ3JvdW5kU3RhY2tSZWZyZXNoIHtcbiAgcHJpdmF0ZSB0aW1lb3V0PzogTm9kZUpTLlRpbWVvdXQ7XG4gIHByaXZhdGUgbGFzdFJlZnJlc2hUaW1lOiBudW1iZXI7XG4gIHByaXZhdGUgcXVldWVkUHJvbWlzZXM6IEFycmF5PCh2YWx1ZTogdW5rbm93bikgPT4gdm9pZD4gPSBbXTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHByb3BzOiBCYWNrZ3JvdW5kU3RhY2tSZWZyZXNoUHJvcHMpIHtcbiAgICB0aGlzLmxhc3RSZWZyZXNoVGltZSA9IERhdGUubm93KCk7XG4gIH1cblxuICBwdWJsaWMgc3RhcnQoKSB7XG4gICAgLy8gU2luY2Ugc3RhcnQgaXMgZ29pbmcgdG8gYmUgY2FsbGVkIHJpZ2h0IGFmdGVyIHRoZSBmaXJzdCBpbnZvY2F0aW9uIG9mIHJlZnJlc2hTdGFja3MsXG4gICAgLy8gbGV0cyB3YWl0IHNvbWUgdGltZSBiZWZvcmUgYmVnaW5uaW5nIHRoZSBiYWNrZ3JvdW5kIHJlZnJlc2guXG4gICAgdGhpcy50aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlZnJlc2goKSwgMzAwXzAwMCk7IC8vIDUgbWludXRlc1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoKCkge1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICBhd2FpdCByZWZyZXNoU3RhY2tzKHRoaXMucHJvcHMuY2ZuLCB0aGlzLnByb3BzLmlvSGVscGVyLCB0aGlzLnByb3BzLmFjdGl2ZUFzc2V0cywgdGhpcy5wcm9wcy5xdWFsaWZpZXIpO1xuICAgIHRoaXMuanVzdFJlZnJlc2hlZFN0YWNrcygpO1xuXG4gICAgLy8gSWYgdGhlIGxhc3QgaW52b2NhdGlvbiBvZiByZWZyZXNoU3RhY2tzIHRha2VzIDw1IG1pbnV0ZXMsIHRoZSBuZXh0IGludm9jYXRpb24gc3RhcnRzIDUgbWludXRlcyBhZnRlciB0aGUgbGFzdCBvbmUgc3RhcnRlZC5cbiAgICAvLyBJZiB0aGUgbGFzdCBpbnZvY2F0aW9uIG9mIHJlZnJlc2hTdGFja3MgdGFrZXMgPjUgbWludXRlcywgdGhlIG5leHQgaW52b2NhdGlvbiBzdGFydHMgaW1tZWRpYXRlbHkuXG4gICAgdGhpcy50aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlZnJlc2goKSwgTWF0aC5tYXgoc3RhcnRUaW1lICsgMzAwXzAwMCAtIERhdGUubm93KCksIDApKTtcbiAgfVxuXG4gIHByaXZhdGUganVzdFJlZnJlc2hlZFN0YWNrcygpIHtcbiAgICB0aGlzLmxhc3RSZWZyZXNoVGltZSA9IERhdGUubm93KCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHRoaXMucXVldWVkUHJvbWlzZXMuc3BsaWNlKDAsIHRoaXMucXVldWVkUHJvbWlzZXMubGVuZ3RoKSkge1xuICAgICAgcCh1bmRlZmluZWQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgdGhlIGxhc3Qgc3VjY2Vzc2Z1bCBiYWNrZ3JvdW5kIHJlZnJlc2ggaGFwcGVuZWQgd2l0aGluIHRoZSBzcGVjaWZpZWQgdGltZSBmcmFtZS5cbiAgICogSWYgdGhlIGxhc3QgcmVmcmVzaCBpcyBvbGRlciB0aGFuIHRoZSBzcGVjaWZpZWQgdGltZSBmcmFtZSwgaXQgcmV0dXJucyBhIFByb21pc2UgdGhhdCByZXNvbHZlc1xuICAgKiB3aGVuIHRoZSBuZXh0IGJhY2tncm91bmQgcmVmcmVzaCBjb21wbGV0ZXMgb3IgcmVqZWN0cyBpZiB0aGUgcmVmcmVzaCB0YWtlcyB0b28gbG9uZy5cbiAgICovXG4gIHB1YmxpYyBub09sZGVyVGhhbihtczogbnVtYmVyKSB7XG4gICAgY29uc3QgaG9yaXpvbiA9IERhdGUubm93KCkgLSBtcztcblxuICAgIC8vIFRoZSBsYXN0IHJlZnJlc2ggaGFwcGVuZWQgd2l0aGluIHRoZSB0aW1lIGZyYW1lXG4gICAgaWYgKHRoaXMubGFzdFJlZnJlc2hUaW1lID49IGhvcml6b24pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICAvLyBUaGUgbGFzdCByZWZyZXNoIGhhcHBlbmVkIGVhcmxpZXIgdGhhbiB0aGUgdGltZSBmcmFtZVxuICAgIC8vIFdlIHdpbGwgd2FpdCBmb3IgdGhlIGxhdGVzdCByZWZyZXNoIHRvIGxhbmQgb3IgcmVqZWN0IGlmIGl0IHRha2VzIHRvbyBsb25nXG4gICAgcmV0dXJuIFByb21pc2UucmFjZShbXG4gICAgICBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHRoaXMucXVldWVkUHJvbWlzZXMucHVzaChyZXNvbHZlKSksXG4gICAgICBuZXcgUHJvbWlzZSgoXywgcmVqZWN0KSA9PiBzZXRUaW1lb3V0KCgpID0+IHJlamVjdChuZXcgVG9vbGtpdEVycm9yKCdyZWZyZXNoU3RhY2tzIHRvb2sgdG9vIGxvbmc7IHRoZSBiYWNrZ3JvdW5kIHRocmVhZCBsaWtlbHkgdGhyZXcgYW4gZXJyb3InKSksIG1zKSksXG4gICAgXSk7XG4gIH1cblxuICBwdWJsaWMgc3RvcCgpIHtcbiAgICBjbGVhclRpbWVvdXQodGhpcy50aW1lb3V0KTtcbiAgfVxufVxuIl19