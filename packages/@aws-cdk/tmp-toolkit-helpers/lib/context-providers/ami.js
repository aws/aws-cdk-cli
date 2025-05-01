"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmiContextProviderPlugin = void 0;
const aws_auth_1 = require("../api/aws-auth");
const toolkit_error_1 = require("../api/toolkit-error");
/**
 * Plugin to search AMIs for the current account
 */
class AmiContextProviderPlugin {
    aws;
    io;
    constructor(aws, io) {
        this.aws = aws;
        this.io = io;
    }
    async getValue(args) {
        const region = args.region;
        const account = args.account;
        // Normally we'd do this only as 'debug', but searching AMIs typically takes dozens
        // of seconds, so be little more verbose about it so users know what is going on.
        await this.io.info(`Searching for AMI in ${account}:${region}`);
        await this.io.debug(`AMI search parameters: ${JSON.stringify(args)}`);
        const ec2 = (await (0, aws_auth_1.initContextProviderSdk)(this.aws, args)).ec2();
        const response = await ec2.describeImages({
            Owners: args.owners,
            Filters: Object.entries(args.filters).map(([key, values]) => ({
                Name: key,
                Values: values,
            })),
        });
        const images = [...(response.Images || [])].filter((i) => i.ImageId !== undefined);
        if (images.length === 0) {
            throw new toolkit_error_1.ContextProviderError('No AMI found that matched the search criteria');
        }
        // Return the most recent one
        // Note: Date.parse() is not going to respect the timezone of the string,
        // but since we only care about the relative values that is okay.
        images.sort(descending((i) => Date.parse(i.CreationDate || '1970')));
        await this.io.debug(`Selected image '${images[0].ImageId}' created at '${images[0].CreationDate}'`);
        return images[0].ImageId;
    }
}
exports.AmiContextProviderPlugin = AmiContextProviderPlugin;
/**
 * Make a comparator that sorts in descending order given a sort key extractor
 */
function descending(valueOf) {
    return (a, b) => {
        return valueOf(b) - valueOf(a);
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW1pLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2NvbnRleHQtcHJvdmlkZXJzL2FtaS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSw4Q0FBMkU7QUFFM0Usd0RBQTREO0FBRTVEOztHQUVHO0FBQ0gsTUFBYSx3QkFBd0I7SUFDTjtJQUFtQztJQUFoRSxZQUE2QixHQUFnQixFQUFtQixFQUE0QjtRQUEvRCxRQUFHLEdBQUgsR0FBRyxDQUFhO1FBQW1CLE9BQUUsR0FBRixFQUFFLENBQTBCO0lBQzVGLENBQUM7SUFFTSxLQUFLLENBQUMsUUFBUSxDQUFDLElBQXFCO1FBQ3pDLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7UUFDM0IsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQztRQUU3QixtRkFBbUY7UUFDbkYsaUZBQWlGO1FBQ2pGLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsd0JBQXdCLE9BQU8sSUFBSSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQ2hFLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsMEJBQTBCLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBRXRFLE1BQU0sR0FBRyxHQUFHLENBQUMsTUFBTSxJQUFBLGlDQUFzQixFQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUNqRSxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsQ0FBQyxjQUFjLENBQUM7WUFDeEMsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ25CLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDNUQsSUFBSSxFQUFFLEdBQUc7Z0JBQ1QsTUFBTSxFQUFFLE1BQU07YUFDZixDQUFDLENBQUM7U0FDSixDQUFDLENBQUM7UUFFSCxNQUFNLE1BQU0sR0FBRyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxLQUFLLFNBQVMsQ0FBQyxDQUFDO1FBRW5GLElBQUksTUFBTSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN4QixNQUFNLElBQUksb0NBQW9CLENBQUMsK0NBQStDLENBQUMsQ0FBQztRQUNsRixDQUFDO1FBRUQsNkJBQTZCO1FBQzdCLHlFQUF5RTtRQUN6RSxpRUFBaUU7UUFDakUsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFlBQVksSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFckUsTUFBTSxJQUFJLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8saUJBQWlCLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLEdBQUcsQ0FBQyxDQUFDO1FBQ3BHLE9BQU8sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQVEsQ0FBQztJQUM1QixDQUFDO0NBQ0Y7QUFwQ0QsNERBb0NDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLFVBQVUsQ0FBSSxPQUF5QjtJQUM5QyxPQUFPLENBQUMsQ0FBSSxFQUFFLENBQUksRUFBRSxFQUFFO1FBQ3BCLE9BQU8sT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNqQyxDQUFDLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBBbWlDb250ZXh0UXVlcnkgfSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHR5cGUgeyBJQ29udGV4dFByb3ZpZGVyTWVzc2FnZXMgfSBmcm9tICcuJztcbmltcG9ydCB7IHR5cGUgU2RrUHJvdmlkZXIsIGluaXRDb250ZXh0UHJvdmlkZXJTZGsgfSBmcm9tICcuLi9hcGkvYXdzLWF1dGgnO1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0UHJvdmlkZXJQbHVnaW4gfSBmcm9tICcuLi9hcGkvcGx1Z2luJztcbmltcG9ydCB7IENvbnRleHRQcm92aWRlckVycm9yIH0gZnJvbSAnLi4vYXBpL3Rvb2xraXQtZXJyb3InO1xuXG4vKipcbiAqIFBsdWdpbiB0byBzZWFyY2ggQU1JcyBmb3IgdGhlIGN1cnJlbnQgYWNjb3VudFxuICovXG5leHBvcnQgY2xhc3MgQW1pQ29udGV4dFByb3ZpZGVyUGx1Z2luIGltcGxlbWVudHMgQ29udGV4dFByb3ZpZGVyUGx1Z2luIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhd3M6IFNka1Byb3ZpZGVyLCBwcml2YXRlIHJlYWRvbmx5IGlvOiBJQ29udGV4dFByb3ZpZGVyTWVzc2FnZXMpIHtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBnZXRWYWx1ZShhcmdzOiBBbWlDb250ZXh0UXVlcnkpIHtcbiAgICBjb25zdCByZWdpb24gPSBhcmdzLnJlZ2lvbjtcbiAgICBjb25zdCBhY2NvdW50ID0gYXJncy5hY2NvdW50O1xuXG4gICAgLy8gTm9ybWFsbHkgd2UnZCBkbyB0aGlzIG9ubHkgYXMgJ2RlYnVnJywgYnV0IHNlYXJjaGluZyBBTUlzIHR5cGljYWxseSB0YWtlcyBkb3plbnNcbiAgICAvLyBvZiBzZWNvbmRzLCBzbyBiZSBsaXR0bGUgbW9yZSB2ZXJib3NlIGFib3V0IGl0IHNvIHVzZXJzIGtub3cgd2hhdCBpcyBnb2luZyBvbi5cbiAgICBhd2FpdCB0aGlzLmlvLmluZm8oYFNlYXJjaGluZyBmb3IgQU1JIGluICR7YWNjb3VudH06JHtyZWdpb259YCk7XG4gICAgYXdhaXQgdGhpcy5pby5kZWJ1ZyhgQU1JIHNlYXJjaCBwYXJhbWV0ZXJzOiAke0pTT04uc3RyaW5naWZ5KGFyZ3MpfWApO1xuXG4gICAgY29uc3QgZWMyID0gKGF3YWl0IGluaXRDb250ZXh0UHJvdmlkZXJTZGsodGhpcy5hd3MsIGFyZ3MpKS5lYzIoKTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGVjMi5kZXNjcmliZUltYWdlcyh7XG4gICAgICBPd25lcnM6IGFyZ3Mub3duZXJzLFxuICAgICAgRmlsdGVyczogT2JqZWN0LmVudHJpZXMoYXJncy5maWx0ZXJzKS5tYXAoKFtrZXksIHZhbHVlc10pID0+ICh7XG4gICAgICAgIE5hbWU6IGtleSxcbiAgICAgICAgVmFsdWVzOiB2YWx1ZXMsXG4gICAgICB9KSksXG4gICAgfSk7XG5cbiAgICBjb25zdCBpbWFnZXMgPSBbLi4uKHJlc3BvbnNlLkltYWdlcyB8fCBbXSldLmZpbHRlcigoaSkgPT4gaS5JbWFnZUlkICE9PSB1bmRlZmluZWQpO1xuXG4gICAgaWYgKGltYWdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBDb250ZXh0UHJvdmlkZXJFcnJvcignTm8gQU1JIGZvdW5kIHRoYXQgbWF0Y2hlZCB0aGUgc2VhcmNoIGNyaXRlcmlhJyk7XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIHRoZSBtb3N0IHJlY2VudCBvbmVcbiAgICAvLyBOb3RlOiBEYXRlLnBhcnNlKCkgaXMgbm90IGdvaW5nIHRvIHJlc3BlY3QgdGhlIHRpbWV6b25lIG9mIHRoZSBzdHJpbmcsXG4gICAgLy8gYnV0IHNpbmNlIHdlIG9ubHkgY2FyZSBhYm91dCB0aGUgcmVsYXRpdmUgdmFsdWVzIHRoYXQgaXMgb2theS5cbiAgICBpbWFnZXMuc29ydChkZXNjZW5kaW5nKChpKSA9PiBEYXRlLnBhcnNlKGkuQ3JlYXRpb25EYXRlIHx8ICcxOTcwJykpKTtcblxuICAgIGF3YWl0IHRoaXMuaW8uZGVidWcoYFNlbGVjdGVkIGltYWdlICcke2ltYWdlc1swXS5JbWFnZUlkfScgY3JlYXRlZCBhdCAnJHtpbWFnZXNbMF0uQ3JlYXRpb25EYXRlfSdgKTtcbiAgICByZXR1cm4gaW1hZ2VzWzBdLkltYWdlSWQhO1xuICB9XG59XG5cbi8qKlxuICogTWFrZSBhIGNvbXBhcmF0b3IgdGhhdCBzb3J0cyBpbiBkZXNjZW5kaW5nIG9yZGVyIGdpdmVuIGEgc29ydCBrZXkgZXh0cmFjdG9yXG4gKi9cbmZ1bmN0aW9uIGRlc2NlbmRpbmc8QT4odmFsdWVPZjogKHg6IEEpID0+IG51bWJlcikge1xuICByZXR1cm4gKGE6IEEsIGI6IEEpID0+IHtcbiAgICByZXR1cm4gdmFsdWVPZihiKSAtIHZhbHVlT2YoYSk7XG4gIH07XG59XG4iXX0=