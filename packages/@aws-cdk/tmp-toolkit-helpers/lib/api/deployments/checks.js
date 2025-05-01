"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineAllowCrossAccountAssetPublishing = determineAllowCrossAccountAssetPublishing;
exports.getBootstrapStackInfo = getBootstrapStackInfo;
const private_1 = require("../io/private");
const toolkit_error_1 = require("../toolkit-error");
async function determineAllowCrossAccountAssetPublishing(sdk, ioHelper, customStackName) {
    try {
        const stackName = customStackName || 'CDKToolkit';
        const stackInfo = await getBootstrapStackInfo(sdk, stackName);
        if (!stackInfo.hasStagingBucket) {
            // indicates an intentional cross account setup
            return true;
        }
        if (stackInfo.bootstrapVersion >= 21) {
            // bootstrap stack version 21 contains a fix that will prevent cross
            // account publishing on the IAM level
            // https://github.com/aws/aws-cdk/pull/30823
            return true;
        }
        // If there is a staging bucket AND the bootstrap version is old, then we want to protect
        // against accidental cross-account publishing.
        return false;
    }
    catch (e) {
        // You would think we would need to fail closed here, but the reality is
        // that we get here if we couldn't find the bootstrap stack: that is
        // completely valid, and many large organizations may have their own method
        // of creating bootstrap resources. If they do, there's nothing for us to validate,
        // but we can't use that as a reason to disallow cross-account publishing. We'll just
        // have to trust they did their due diligence. So we fail open.
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Error determining cross account asset publishing: ${e}`));
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg('Defaulting to allowing cross account asset publishing'));
        return true;
    }
}
async function getBootstrapStackInfo(sdk, stackName) {
    try {
        const cfn = sdk.cloudFormation();
        const stackResponse = await cfn.describeStacks({ StackName: stackName });
        if (!stackResponse.Stacks || stackResponse.Stacks.length === 0) {
            throw new toolkit_error_1.ToolkitError(`Toolkit stack ${stackName} not found`);
        }
        const stack = stackResponse.Stacks[0];
        const versionOutput = stack.Outputs?.find(output => output.OutputKey === 'BootstrapVersion');
        if (!versionOutput?.OutputValue) {
            throw new toolkit_error_1.ToolkitError(`Unable to find BootstrapVersion output in the toolkit stack ${stackName}`);
        }
        const bootstrapVersion = parseInt(versionOutput.OutputValue);
        if (isNaN(bootstrapVersion)) {
            throw new toolkit_error_1.ToolkitError(`Invalid BootstrapVersion value: ${versionOutput.OutputValue}`);
        }
        // try to get bucketname from the logical resource id. If there is no
        // bucketname, or the value doesn't look like an S3 bucket name, we assume
        // the bucket doesn't exist (this is for the case where a template customizer did
        // not dare to remove the Output, but put a dummy value there like '' or '-' or '***').
        //
        // We would have preferred to look at the stack resources here, but
        // unfortunately the deploy role doesn't have permissions call DescribeStackResources.
        const bucketName = stack.Outputs?.find(output => output.OutputKey === 'BucketName')?.OutputValue;
        // Must begin and end with letter or number.
        const hasStagingBucket = !!(bucketName && bucketName.match(/^[a-z0-9]/) && bucketName.match(/[a-z0-9]$/));
        return {
            hasStagingBucket,
            bootstrapVersion,
        };
    }
    catch (e) {
        throw new toolkit_error_1.ToolkitError(`Error retrieving toolkit stack info: ${e}`);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hlY2tzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9kZXBsb3ltZW50cy9jaGVja3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFJQSw4RkFtQ0M7QUFPRCxzREF1Q0M7QUFwRkQsMkNBQWtEO0FBQ2xELG9EQUFnRDtBQUV6QyxLQUFLLFVBQVUseUNBQXlDLENBQzdELEdBQVEsRUFDUixRQUFrQixFQUNsQixlQUF3QjtJQUV4QixJQUFJLENBQUM7UUFDSCxNQUFNLFNBQVMsR0FBRyxlQUFlLElBQUksWUFBWSxDQUFDO1FBQ2xELE1BQU0sU0FBUyxHQUFHLE1BQU0scUJBQXFCLENBQUMsR0FBRyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBRTlELElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUNoQywrQ0FBK0M7WUFDL0MsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsSUFBSSxTQUFTLENBQUMsZ0JBQWdCLElBQUksRUFBRSxFQUFFLENBQUM7WUFDckMsb0VBQW9FO1lBQ3BFLHNDQUFzQztZQUN0Qyw0Q0FBNEM7WUFDNUMsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQseUZBQXlGO1FBQ3pGLCtDQUErQztRQUMvQyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ1gsd0VBQXdFO1FBQ3hFLG9FQUFvRTtRQUNwRSwyRUFBMkU7UUFDM0UsbUZBQW1GO1FBQ25GLHFGQUFxRjtRQUNyRiwrREFBK0Q7UUFDL0QsTUFBTSxRQUFRLENBQUMsTUFBTSxDQUFDLFlBQUUsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMscURBQXFELENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUM5RyxNQUFNLFFBQVEsQ0FBQyxNQUFNLENBQUMsWUFBRSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyx1REFBdUQsQ0FBQyxDQUFDLENBQUM7UUFDN0csT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQztBQU9NLEtBQUssVUFBVSxxQkFBcUIsQ0FBQyxHQUFRLEVBQUUsU0FBaUI7SUFDckUsSUFBSSxDQUFDO1FBQ0gsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ2pDLE1BQU0sYUFBYSxHQUFHLE1BQU0sR0FBRyxDQUFDLGNBQWMsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBRXpFLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxJQUFJLGFBQWEsQ0FBQyxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQy9ELE1BQU0sSUFBSSw0QkFBWSxDQUFDLGlCQUFpQixTQUFTLFlBQVksQ0FBQyxDQUFDO1FBQ2pFLENBQUM7UUFFRCxNQUFNLEtBQUssR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3RDLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLFNBQVMsS0FBSyxrQkFBa0IsQ0FBQyxDQUFDO1FBRTdGLElBQUksQ0FBQyxhQUFhLEVBQUUsV0FBVyxFQUFFLENBQUM7WUFDaEMsTUFBTSxJQUFJLDRCQUFZLENBQUMsK0RBQStELFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDckcsQ0FBQztRQUVELE1BQU0sZ0JBQWdCLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUM3RCxJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7WUFDNUIsTUFBTSxJQUFJLDRCQUFZLENBQUMsbUNBQW1DLGFBQWEsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ3pGLENBQUM7UUFFRCxxRUFBcUU7UUFDckUsMEVBQTBFO1FBQzFFLGlGQUFpRjtRQUNqRix1RkFBdUY7UUFDdkYsRUFBRTtRQUNGLG1FQUFtRTtRQUNuRSxzRkFBc0Y7UUFDdEYsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsU0FBUyxLQUFLLFlBQVksQ0FBQyxFQUFFLFdBQVcsQ0FBQztRQUNqRyw0Q0FBNEM7UUFDNUMsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsQ0FBQyxVQUFVLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7UUFFMUcsT0FBTztZQUNMLGdCQUFnQjtZQUNoQixnQkFBZ0I7U0FDakIsQ0FBQztJQUNKLENBQUM7SUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ1gsTUFBTSxJQUFJLDRCQUFZLENBQUMsd0NBQXdDLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDdEUsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IFNESyB9IGZyb20gJy4uL2F3cy1hdXRoJztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRldGVybWluZUFsbG93Q3Jvc3NBY2NvdW50QXNzZXRQdWJsaXNoaW5nKFxuICBzZGs6IFNESyxcbiAgaW9IZWxwZXI6IElvSGVscGVyLFxuICBjdXN0b21TdGFja05hbWU/OiBzdHJpbmcsXG4pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGFja05hbWUgPSBjdXN0b21TdGFja05hbWUgfHwgJ0NES1Rvb2xraXQnO1xuICAgIGNvbnN0IHN0YWNrSW5mbyA9IGF3YWl0IGdldEJvb3RzdHJhcFN0YWNrSW5mbyhzZGssIHN0YWNrTmFtZSk7XG5cbiAgICBpZiAoIXN0YWNrSW5mby5oYXNTdGFnaW5nQnVja2V0KSB7XG4gICAgICAvLyBpbmRpY2F0ZXMgYW4gaW50ZW50aW9uYWwgY3Jvc3MgYWNjb3VudCBzZXR1cFxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgaWYgKHN0YWNrSW5mby5ib290c3RyYXBWZXJzaW9uID49IDIxKSB7XG4gICAgICAvLyBib290c3RyYXAgc3RhY2sgdmVyc2lvbiAyMSBjb250YWlucyBhIGZpeCB0aGF0IHdpbGwgcHJldmVudCBjcm9zc1xuICAgICAgLy8gYWNjb3VudCBwdWJsaXNoaW5nIG9uIHRoZSBJQU0gbGV2ZWxcbiAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9wdWxsLzMwODIzXG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBJZiB0aGVyZSBpcyBhIHN0YWdpbmcgYnVja2V0IEFORCB0aGUgYm9vdHN0cmFwIHZlcnNpb24gaXMgb2xkLCB0aGVuIHdlIHdhbnQgdG8gcHJvdGVjdFxuICAgIC8vIGFnYWluc3QgYWNjaWRlbnRhbCBjcm9zcy1hY2NvdW50IHB1Ymxpc2hpbmcuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGNhdGNoIChlKSB7XG4gICAgLy8gWW91IHdvdWxkIHRoaW5rIHdlIHdvdWxkIG5lZWQgdG8gZmFpbCBjbG9zZWQgaGVyZSwgYnV0IHRoZSByZWFsaXR5IGlzXG4gICAgLy8gdGhhdCB3ZSBnZXQgaGVyZSBpZiB3ZSBjb3VsZG4ndCBmaW5kIHRoZSBib290c3RyYXAgc3RhY2s6IHRoYXQgaXNcbiAgICAvLyBjb21wbGV0ZWx5IHZhbGlkLCBhbmQgbWFueSBsYXJnZSBvcmdhbml6YXRpb25zIG1heSBoYXZlIHRoZWlyIG93biBtZXRob2RcbiAgICAvLyBvZiBjcmVhdGluZyBib290c3RyYXAgcmVzb3VyY2VzLiBJZiB0aGV5IGRvLCB0aGVyZSdzIG5vdGhpbmcgZm9yIHVzIHRvIHZhbGlkYXRlLFxuICAgIC8vIGJ1dCB3ZSBjYW4ndCB1c2UgdGhhdCBhcyBhIHJlYXNvbiB0byBkaXNhbGxvdyBjcm9zcy1hY2NvdW50IHB1Ymxpc2hpbmcuIFdlJ2xsIGp1c3RcbiAgICAvLyBoYXZlIHRvIHRydXN0IHRoZXkgZGlkIHRoZWlyIGR1ZSBkaWxpZ2VuY2UuIFNvIHdlIGZhaWwgb3Blbi5cbiAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgRXJyb3IgZGV0ZXJtaW5pbmcgY3Jvc3MgYWNjb3VudCBhc3NldCBwdWJsaXNoaW5nOiAke2V9YCkpO1xuICAgIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKCdEZWZhdWx0aW5nIHRvIGFsbG93aW5nIGNyb3NzIGFjY291bnQgYXNzZXQgcHVibGlzaGluZycpKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG5pbnRlcmZhY2UgQm9vdHN0cmFwU3RhY2tJbmZvIHtcbiAgaGFzU3RhZ2luZ0J1Y2tldDogYm9vbGVhbjtcbiAgYm9vdHN0cmFwVmVyc2lvbjogbnVtYmVyO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0Qm9vdHN0cmFwU3RhY2tJbmZvKHNkazogU0RLLCBzdGFja05hbWU6IHN0cmluZyk6IFByb21pc2U8Qm9vdHN0cmFwU3RhY2tJbmZvPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgY2ZuID0gc2RrLmNsb3VkRm9ybWF0aW9uKCk7XG4gICAgY29uc3Qgc3RhY2tSZXNwb25zZSA9IGF3YWl0IGNmbi5kZXNjcmliZVN0YWNrcyh7IFN0YWNrTmFtZTogc3RhY2tOYW1lIH0pO1xuXG4gICAgaWYgKCFzdGFja1Jlc3BvbnNlLlN0YWNrcyB8fCBzdGFja1Jlc3BvbnNlLlN0YWNrcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYFRvb2xraXQgc3RhY2sgJHtzdGFja05hbWV9IG5vdCBmb3VuZGApO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YWNrID0gc3RhY2tSZXNwb25zZS5TdGFja3NbMF07XG4gICAgY29uc3QgdmVyc2lvbk91dHB1dCA9IHN0YWNrLk91dHB1dHM/LmZpbmQob3V0cHV0ID0+IG91dHB1dC5PdXRwdXRLZXkgPT09ICdCb290c3RyYXBWZXJzaW9uJyk7XG5cbiAgICBpZiAoIXZlcnNpb25PdXRwdXQ/Lk91dHB1dFZhbHVlKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBVbmFibGUgdG8gZmluZCBCb290c3RyYXBWZXJzaW9uIG91dHB1dCBpbiB0aGUgdG9vbGtpdCBzdGFjayAke3N0YWNrTmFtZX1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBib290c3RyYXBWZXJzaW9uID0gcGFyc2VJbnQodmVyc2lvbk91dHB1dC5PdXRwdXRWYWx1ZSk7XG4gICAgaWYgKGlzTmFOKGJvb3RzdHJhcFZlcnNpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBJbnZhbGlkIEJvb3RzdHJhcFZlcnNpb24gdmFsdWU6ICR7dmVyc2lvbk91dHB1dC5PdXRwdXRWYWx1ZX1gKTtcbiAgICB9XG5cbiAgICAvLyB0cnkgdG8gZ2V0IGJ1Y2tldG5hbWUgZnJvbSB0aGUgbG9naWNhbCByZXNvdXJjZSBpZC4gSWYgdGhlcmUgaXMgbm9cbiAgICAvLyBidWNrZXRuYW1lLCBvciB0aGUgdmFsdWUgZG9lc24ndCBsb29rIGxpa2UgYW4gUzMgYnVja2V0IG5hbWUsIHdlIGFzc3VtZVxuICAgIC8vIHRoZSBidWNrZXQgZG9lc24ndCBleGlzdCAodGhpcyBpcyBmb3IgdGhlIGNhc2Ugd2hlcmUgYSB0ZW1wbGF0ZSBjdXN0b21pemVyIGRpZFxuICAgIC8vIG5vdCBkYXJlIHRvIHJlbW92ZSB0aGUgT3V0cHV0LCBidXQgcHV0IGEgZHVtbXkgdmFsdWUgdGhlcmUgbGlrZSAnJyBvciAnLScgb3IgJyoqKicpLlxuICAgIC8vXG4gICAgLy8gV2Ugd291bGQgaGF2ZSBwcmVmZXJyZWQgdG8gbG9vayBhdCB0aGUgc3RhY2sgcmVzb3VyY2VzIGhlcmUsIGJ1dFxuICAgIC8vIHVuZm9ydHVuYXRlbHkgdGhlIGRlcGxveSByb2xlIGRvZXNuJ3QgaGF2ZSBwZXJtaXNzaW9ucyBjYWxsIERlc2NyaWJlU3RhY2tSZXNvdXJjZXMuXG4gICAgY29uc3QgYnVja2V0TmFtZSA9IHN0YWNrLk91dHB1dHM/LmZpbmQob3V0cHV0ID0+IG91dHB1dC5PdXRwdXRLZXkgPT09ICdCdWNrZXROYW1lJyk/Lk91dHB1dFZhbHVlO1xuICAgIC8vIE11c3QgYmVnaW4gYW5kIGVuZCB3aXRoIGxldHRlciBvciBudW1iZXIuXG4gICAgY29uc3QgaGFzU3RhZ2luZ0J1Y2tldCA9ICEhKGJ1Y2tldE5hbWUgJiYgYnVja2V0TmFtZS5tYXRjaCgvXlthLXowLTldLykgJiYgYnVja2V0TmFtZS5tYXRjaCgvW2EtejAtOV0kLykpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGhhc1N0YWdpbmdCdWNrZXQsXG4gICAgICBib290c3RyYXBWZXJzaW9uLFxuICAgIH07XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBFcnJvciByZXRyaWV2aW5nIHRvb2xraXQgc3RhY2sgaW5mbzogJHtlfWApO1xuICB9XG59XG4iXX0=