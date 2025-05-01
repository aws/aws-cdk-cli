"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CcApiContextProviderPlugin = void 0;
const client_cloudcontrol_1 = require("@aws-sdk/client-cloudcontrol");
const aws_auth_1 = require("../api/aws-auth");
const toolkit_error_1 = require("../api/toolkit-error");
const util_1 = require("../util");
class CcApiContextProviderPlugin {
    aws;
    constructor(aws) {
        this.aws = aws;
    }
    /**
     * This returns a data object with the value from CloudControl API result.
     *
     * See the documentation in the Cloud Assembly Schema for the semantics of
     * each query parameter.
     */
    async getValue(args) {
        // Validate input
        if (args.exactIdentifier && args.propertyMatch) {
            throw new toolkit_error_1.ContextProviderError(`Provider protocol error: specify either exactIdentifier or propertyMatch, but not both (got ${JSON.stringify(args)})`);
        }
        if (args.ignoreErrorOnMissingContext && args.dummyValue === undefined) {
            throw new toolkit_error_1.ContextProviderError(`Provider protocol error: if ignoreErrorOnMissingContext is set, a dummyValue must be supplied (got ${JSON.stringify(args)})`);
        }
        if (args.dummyValue !== undefined && (!Array.isArray(args.dummyValue) || !args.dummyValue.every(isObject))) {
            throw new toolkit_error_1.ContextProviderError(`Provider protocol error: dummyValue must be an array of objects (got ${JSON.stringify(args.dummyValue)})`);
        }
        // Do the lookup
        const cloudControl = (await (0, aws_auth_1.initContextProviderSdk)(this.aws, args)).cloudControl();
        try {
            let resources;
            if (args.exactIdentifier) {
                // use getResource to get the exact indentifier
                resources = await this.getResource(cloudControl, args.typeName, args.exactIdentifier);
            }
            else if (args.propertyMatch) {
                // use listResource
                resources = await this.listResources(cloudControl, args.typeName, args.propertyMatch, args.expectedMatchCount);
            }
            else {
                throw new toolkit_error_1.ContextProviderError(`Provider protocol error: neither exactIdentifier nor propertyMatch is specified in ${JSON.stringify(args)}.`);
            }
            return resources.map((r) => (0, util_1.getResultObj)(r.properties, r.identifier, args.propertiesToReturn));
        }
        catch (err) {
            if (err instanceof ZeroResourcesFoundError && args.ignoreErrorOnMissingContext) {
                // We've already type-checked dummyValue.
                return args.dummyValue;
            }
            throw err;
        }
    }
    /**
     * Calls getResource from CC API to get the resource.
     * See https://docs.aws.amazon.com/cli/latest/reference/cloudcontrol/get-resource.html
     *
     * Will always return exactly one resource, or fail.
     */
    async getResource(cc, typeName, exactIdentifier) {
        try {
            const result = await cc.getResource({
                TypeName: typeName,
                Identifier: exactIdentifier,
            });
            if (!result.ResourceDescription) {
                throw new toolkit_error_1.ContextProviderError('Unexpected CloudControl API behavior: returned empty response');
            }
            return [foundResourceFromCcApi(result.ResourceDescription)];
        }
        catch (err) {
            if (err instanceof client_cloudcontrol_1.ResourceNotFoundException || err.name === 'ResourceNotFoundException') {
                throw new ZeroResourcesFoundError(`No resource of type ${typeName} with identifier: ${exactIdentifier}`);
            }
            if (!(err instanceof toolkit_error_1.ContextProviderError)) {
                throw new toolkit_error_1.ContextProviderError(`Encountered CC API error while getting ${typeName} resource ${exactIdentifier}: ${err.message}`);
            }
            throw err;
        }
    }
    /**
     * Calls listResources from CC API to get the resources and apply args.propertyMatch to find the resources.
     * See https://docs.aws.amazon.com/cli/latest/reference/cloudcontrol/list-resources.html
     *
     * Will return 0 or more resources.
     *
     * Does not currently paginate through more than one result page.
     */
    async listResources(cc, typeName, propertyMatch, expectedMatchCount) {
        try {
            const result = await cc.listResources({
                TypeName: typeName,
            });
            const found = (result.ResourceDescriptions ?? [])
                .map(foundResourceFromCcApi)
                .filter((r) => {
                return Object.entries(propertyMatch).every(([propPath, expected]) => {
                    const actual = (0, util_1.findJsonValue)(r.properties, propPath);
                    return propertyMatchesFilter(actual, expected);
                });
            });
            if ((expectedMatchCount === 'at-least-one' || expectedMatchCount === 'exactly-one') && found.length === 0) {
                throw new ZeroResourcesFoundError(`Could not find any resources matching ${JSON.stringify(propertyMatch)}`);
            }
            if ((expectedMatchCount === 'at-most-one' || expectedMatchCount === 'exactly-one') && found.length > 1) {
                throw new toolkit_error_1.ContextProviderError(`Found ${found.length} resources matching ${JSON.stringify(propertyMatch)}; please narrow the search criteria`);
            }
            return found;
        }
        catch (err) {
            if (!(err instanceof toolkit_error_1.ContextProviderError) && !(err instanceof ZeroResourcesFoundError)) {
                throw new toolkit_error_1.ContextProviderError(`Encountered CC API error while listing ${typeName} resources matching ${JSON.stringify(propertyMatch)}: ${err.message}`);
            }
            throw err;
        }
    }
}
exports.CcApiContextProviderPlugin = CcApiContextProviderPlugin;
/**
 * Convert a CC API response object into a nicer object (parse the JSON)
 */
function foundResourceFromCcApi(desc) {
    return {
        identifier: desc.Identifier ?? '*MISSING*',
        properties: JSON.parse(desc.Properties ?? '{}'),
    };
}
/**
 * Whether the given property value matches the given filter
 *
 * For now we just check for strict equality, but we can implement pattern matching and fuzzy matching here later
 */
function propertyMatchesFilter(actual, expected) {
    return expected === actual;
}
function isObject(x) {
    return typeof x === 'object' && x !== null && !Array.isArray(x);
}
/**
 * A specific lookup failure indicating 0 resources found that can be recovered
 */
class ZeroResourcesFoundError extends Error {
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2MtYXBpLXByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2NvbnRleHQtcHJvdmlkZXJzL2NjLWFwaS1wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSxzRUFBeUU7QUFFekUsOENBQXlEO0FBRXpELHdEQUE0RDtBQUM1RCxrQ0FBc0Q7QUFFdEQsTUFBYSwwQkFBMEI7SUFDUjtJQUE3QixZQUE2QixHQUFnQjtRQUFoQixRQUFHLEdBQUgsR0FBRyxDQUFhO0lBQzdDLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNJLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBdUI7UUFDM0MsaUJBQWlCO1FBQ2pCLElBQUksSUFBSSxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDL0MsTUFBTSxJQUFJLG9DQUFvQixDQUFDLCtGQUErRixJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN6SixDQUFDO1FBQ0QsSUFBSSxJQUFJLENBQUMsMkJBQTJCLElBQUksSUFBSSxDQUFDLFVBQVUsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUN0RSxNQUFNLElBQUksb0NBQW9CLENBQUMsc0dBQXNHLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2hLLENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQyxVQUFVLEtBQUssU0FBUyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUMzRyxNQUFNLElBQUksb0NBQW9CLENBQUMsd0VBQXdFLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUM3SSxDQUFDO1FBRUQsZ0JB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Q0FBb0IsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLFlBQVksdUJBQXVCLENBQUMsRUFBRSxDQUFDO2dCQUN4RixNQUFNLElBQUksb0NBQW9CLENBQUMsMENBQTBDLFFBQVEsdUJBQXVCLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLEtBQUssR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7WUFDM0osQ0FBQztZQUNELE1BQU0sR0FBRyxDQUFDO1FBQ1osQ0FBQztJQUNILENBQUM7Q0FDRjtBQTFIRCxnRUEwSEM7QUFFRDs7R0FFRztBQUNILFNBQVMsc0JBQXNCLENBQUMsSUFBeUI7SUFDdkQsT0FBTztRQUNMLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVSxJQUFJLFdBQVc7UUFDMUMsVUFBVSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUM7S0FDaEQsQ0FBQztBQUNKLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxxQkFBcUIsQ0FBQyxNQUFlLEVBQUUsUUFBaUI7SUFDL0QsT0FBTyxRQUFRLEtBQUssTUFBTSxDQUFDO0FBQzdCLENBQUM7QUFFRCxTQUFTLFFBQVEsQ0FBQyxDQUFVO0lBQzFCLE9BQU8sT0FBTyxDQUFDLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ2xFLENBQUM7QUFVRDs7R0FFRztBQUNILE1BQU0sdUJBQXdCLFNBQVEsS0FBSztDQUMxQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQ2NBcGlDb250ZXh0UXVlcnkgfSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHR5cGUgeyBSZXNvdXJjZURlc2NyaXB0aW9uIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkY29udHJvbCc7XG5pbXBvcnQgeyBSZXNvdXJjZU5vdEZvdW5kRXhjZXB0aW9uIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkY29udHJvbCc7XG5pbXBvcnQgdHlwZSB7IElDbG91ZENvbnRyb2xDbGllbnQsIFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXBpL2F3cy1hdXRoJztcbmltcG9ydCB7IGluaXRDb250ZXh0UHJvdmlkZXJTZGsgfSBmcm9tICcuLi9hcGkvYXdzLWF1dGgnO1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0UHJvdmlkZXJQbHVnaW4gfSBmcm9tICcuLi9hcGkvcGx1Z2luJztcbmltcG9ydCB7IENvbnRleHRQcm92aWRlckVycm9yIH0gZnJvbSAnLi4vYXBpL3Rvb2xraXQtZXJyb3InO1xuaW1wb3J0IHsgZmluZEpzb25WYWx1ZSwgZ2V0UmVzdWx0T2JqIH0gZnJvbSAnLi4vdXRpbCc7XG5cbmV4cG9ydCBjbGFzcyBDY0FwaUNvbnRleHRQcm92aWRlclBsdWdpbiBpbXBsZW1lbnRzIENvbnRleHRQcm92aWRlclBsdWdpbiB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgYXdzOiBTZGtQcm92aWRlcikge1xuICB9XG5cbiAgLyoqXG4gICAqIFRoaXMgcmV0dXJucyBhIGRhdGEgb2JqZWN0IHdpdGggdGhlIHZhbHVlIGZyb20gQ2xvdWRDb250cm9sIEFQSSByZXN1bHQuXG4gICAqXG4gICAqIFNlZSB0aGUgZG9jdW1lbnRhdGlvbiBpbiB0aGUgQ2xvdWQgQXNzZW1ibHkgU2NoZW1hIGZvciB0aGUgc2VtYW50aWNzIG9mXG4gICAqIGVhY2ggcXVlcnkgcGFyYW1ldGVyLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIGdldFZhbHVlKGFyZ3M6IENjQXBpQ29udGV4dFF1ZXJ5KSB7XG4gICAgLy8gVmFsaWRhdGUgaW5wdXRcbiAgICBpZiAoYXJncy5leGFjdElkZW50aWZpZXIgJiYgYXJncy5wcm9wZXJ0eU1hdGNoKSB7XG4gICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoYFByb3ZpZGVyIHByb3RvY29sIGVycm9yOiBzcGVjaWZ5IGVpdGhlciBleGFjdElkZW50aWZpZXIgb3IgcHJvcGVydHlNYXRjaCwgYnV0IG5vdCBib3RoIChnb3QgJHtKU09OLnN0cmluZ2lmeShhcmdzKX0pYCk7XG4gICAgfVxuICAgIGlmIChhcmdzLmlnbm9yZUVycm9yT25NaXNzaW5nQ29udGV4dCAmJiBhcmdzLmR1bW15VmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKGBQcm92aWRlciBwcm90b2NvbCBlcnJvcjogaWYgaWdub3JlRXJyb3JPbk1pc3NpbmdDb250ZXh0IGlzIHNldCwgYSBkdW1teVZhbHVlIG11c3QgYmUgc3VwcGxpZWQgKGdvdCAke0pTT04uc3RyaW5naWZ5KGFyZ3MpfSlgKTtcbiAgICB9XG4gICAgaWYgKGFyZ3MuZHVtbXlWYWx1ZSAhPT0gdW5kZWZpbmVkICYmICghQXJyYXkuaXNBcnJheShhcmdzLmR1bW15VmFsdWUpIHx8ICFhcmdzLmR1bW15VmFsdWUuZXZlcnkoaXNPYmplY3QpKSkge1xuICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKGBQcm92aWRlciBwcm90b2NvbCBlcnJvcjogZHVtbXlWYWx1ZSBtdXN0IGJlIGFuIGFycmF5IG9mIG9iamVjdHMgKGdvdCAke0pTT04uc3RyaW5naWZ5KGFyZ3MuZHVtbXlWYWx1ZSl9KWApO1xuICAgIH1cblxuICAgIC8vIERvIHRoZSBsb29rdXBcbiAgICBjb25zdCBjbG91ZENvbnRyb2wgPSAoYXdhaXQgaW5pdENvbnRleHRQcm92aWRlclNkayh0aGlzLmF3cywgYXJncykpLmNsb3VkQ29udHJvbCgpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGxldCByZXNvdXJjZXM6IEZvdW5kUmVzb3VyY2VbXTtcbiAgICAgIGlmIChhcmdzLmV4YWN0SWRlbnRpZmllcikge1xuICAgICAgICAvLyB1c2UgZ2V0UmVzb3VyY2UgdG8gZ2V0IHRoZSBleGFjdCBpbmRlbnRpZmllclxuICAgICAgICByZXNvdXJjZXMgPSBhd2FpdCB0aGlzLmdldFJlc291cmNlKGNsb3VkQ29udHJvbCwgYXJncy50eXBlTmFtZSwgYXJncy5leGFjdElkZW50aWZpZXIpO1xuICAgICAgfSBlbHNlIGlmIChhcmdzLnByb3BlcnR5TWF0Y2gpIHtcbiAgICAgICAgLy8gdXNlIGxpc3RSZXNvdXJjZVxuICAgICAgICByZXNvdXJjZXMgPSBhd2FpdCB0aGlzLmxpc3RSZXNvdXJjZXMoY2xvdWRDb250cm9sLCBhcmdzLnR5cGVOYW1lLCBhcmdzLnByb3BlcnR5TWF0Y2gsIGFyZ3MuZXhwZWN0ZWRNYXRjaENvdW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBDb250ZXh0UHJvdmlkZXJFcnJvcihgUHJvdmlkZXIgcHJvdG9jb2wgZXJyb3I6IG5laXRoZXIgZXhhY3RJZGVudGlmaWVyIG5vciBwcm9wZXJ0eU1hdGNoIGlzIHNwZWNpZmllZCBpbiAke0pTT04uc3RyaW5naWZ5KGFyZ3MpfS5gKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc291cmNlcy5tYXAoKHIpID0+IGdldFJlc3VsdE9iaihyLnByb3BlcnRpZXMsIHIuaWRlbnRpZmllciwgYXJncy5wcm9wZXJ0aWVzVG9SZXR1cm4pKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBaZXJvUmVzb3VyY2VzRm91bmRFcnJvciAmJiBhcmdzLmlnbm9yZUVycm9yT25NaXNzaW5nQ29udGV4dCkge1xuICAgICAgICAvLyBXZSd2ZSBhbHJlYWR5IHR5cGUtY2hlY2tlZCBkdW1teVZhbHVlLlxuICAgICAgICByZXR1cm4gYXJncy5kdW1teVZhbHVlO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxscyBnZXRSZXNvdXJjZSBmcm9tIENDIEFQSSB0byBnZXQgdGhlIHJlc291cmNlLlxuICAgKiBTZWUgaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2NsaS9sYXRlc3QvcmVmZXJlbmNlL2Nsb3VkY29udHJvbC9nZXQtcmVzb3VyY2UuaHRtbFxuICAgKlxuICAgKiBXaWxsIGFsd2F5cyByZXR1cm4gZXhhY3RseSBvbmUgcmVzb3VyY2UsIG9yIGZhaWwuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGdldFJlc291cmNlKFxuICAgIGNjOiBJQ2xvdWRDb250cm9sQ2xpZW50LFxuICAgIHR5cGVOYW1lOiBzdHJpbmcsXG4gICAgZXhhY3RJZGVudGlmaWVyOiBzdHJpbmcsXG4gICk6IFByb21pc2U8Rm91bmRSZXNvdXJjZVtdPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNjLmdldFJlc291cmNlKHtcbiAgICAgICAgVHlwZU5hbWU6IHR5cGVOYW1lLFxuICAgICAgICBJZGVudGlmaWVyOiBleGFjdElkZW50aWZpZXIsXG4gICAgICB9KTtcbiAgICAgIGlmICghcmVzdWx0LlJlc291cmNlRGVzY3JpcHRpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKCdVbmV4cGVjdGVkIENsb3VkQ29udHJvbCBBUEkgYmVoYXZpb3I6IHJldHVybmVkIGVtcHR5IHJlc3BvbnNlJyk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBbZm91bmRSZXNvdXJjZUZyb21DY0FwaShyZXN1bHQuUmVzb3VyY2VEZXNjcmlwdGlvbildO1xuICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgUmVzb3VyY2VOb3RGb3VuZEV4Y2VwdGlvbiB8fCAoZXJyIGFzIGFueSkubmFtZSA9PT0gJ1Jlc291cmNlTm90Rm91bmRFeGNlcHRpb24nKSB7XG4gICAgICAgIHRocm93IG5ldyBaZXJvUmVzb3VyY2VzRm91bmRFcnJvcihgTm8gcmVzb3VyY2Ugb2YgdHlwZSAke3R5cGVOYW1lfSB3aXRoIGlkZW50aWZpZXI6ICR7ZXhhY3RJZGVudGlmaWVyfWApO1xuICAgICAgfVxuICAgICAgaWYgKCEoZXJyIGluc3RhbmNlb2YgQ29udGV4dFByb3ZpZGVyRXJyb3IpKSB7XG4gICAgICAgIHRocm93IG5ldyBDb250ZXh0UHJvdmlkZXJFcnJvcihgRW5jb3VudGVyZWQgQ0MgQVBJIGVycm9yIHdoaWxlIGdldHRpbmcgJHt0eXBlTmFtZX0gcmVzb3VyY2UgJHtleGFjdElkZW50aWZpZXJ9OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxscyBsaXN0UmVzb3VyY2VzIGZyb20gQ0MgQVBJIHRvIGdldCB0aGUgcmVzb3VyY2VzIGFuZCBhcHBseSBhcmdzLnByb3BlcnR5TWF0Y2ggdG8gZmluZCB0aGUgcmVzb3VyY2VzLlxuICAgKiBTZWUgaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2NsaS9sYXRlc3QvcmVmZXJlbmNlL2Nsb3VkY29udHJvbC9saXN0LXJlc291cmNlcy5odG1sXG4gICAqXG4gICAqIFdpbGwgcmV0dXJuIDAgb3IgbW9yZSByZXNvdXJjZXMuXG4gICAqXG4gICAqIERvZXMgbm90IGN1cnJlbnRseSBwYWdpbmF0ZSB0aHJvdWdoIG1vcmUgdGhhbiBvbmUgcmVzdWx0IHBhZ2UuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGxpc3RSZXNvdXJjZXMoXG4gICAgY2M6IElDbG91ZENvbnRyb2xDbGllbnQsXG4gICAgdHlwZU5hbWU6IHN0cmluZyxcbiAgICBwcm9wZXJ0eU1hdGNoOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICBleHBlY3RlZE1hdGNoQ291bnQ/OiBDY0FwaUNvbnRleHRRdWVyeVsnZXhwZWN0ZWRNYXRjaENvdW50J10sXG4gICk6IFByb21pc2U8Rm91bmRSZXNvdXJjZVtdPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNjLmxpc3RSZXNvdXJjZXMoe1xuICAgICAgICBUeXBlTmFtZTogdHlwZU5hbWUsXG5cbiAgICAgIH0pO1xuICAgICAgY29uc3QgZm91bmQgPSAocmVzdWx0LlJlc291cmNlRGVzY3JpcHRpb25zID8/IFtdKVxuICAgICAgICAubWFwKGZvdW5kUmVzb3VyY2VGcm9tQ2NBcGkpXG4gICAgICAgIC5maWx0ZXIoKHIpID0+IHtcbiAgICAgICAgICByZXR1cm4gT2JqZWN0LmVudHJpZXMocHJvcGVydHlNYXRjaCkuZXZlcnkoKFtwcm9wUGF0aCwgZXhwZWN0ZWRdKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhY3R1YWwgPSBmaW5kSnNvblZhbHVlKHIucHJvcGVydGllcywgcHJvcFBhdGgpO1xuICAgICAgICAgICAgcmV0dXJuIHByb3BlcnR5TWF0Y2hlc0ZpbHRlcihhY3R1YWwsIGV4cGVjdGVkKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIGlmICgoZXhwZWN0ZWRNYXRjaENvdW50ID09PSAnYXQtbGVhc3Qtb25lJyB8fCBleHBlY3RlZE1hdGNoQ291bnQgPT09ICdleGFjdGx5LW9uZScpICYmIGZvdW5kLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgWmVyb1Jlc291cmNlc0ZvdW5kRXJyb3IoYENvdWxkIG5vdCBmaW5kIGFueSByZXNvdXJjZXMgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeShwcm9wZXJ0eU1hdGNoKX1gKTtcbiAgICAgIH1cbiAgICAgIGlmICgoZXhwZWN0ZWRNYXRjaENvdW50ID09PSAnYXQtbW9zdC1vbmUnIHx8IGV4cGVjdGVkTWF0Y2hDb3VudCA9PT0gJ2V4YWN0bHktb25lJykgJiYgZm91bmQubGVuZ3RoID4gMSkge1xuICAgICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoYEZvdW5kICR7Zm91bmQubGVuZ3RofSByZXNvdXJjZXMgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeShwcm9wZXJ0eU1hdGNoKX07IHBsZWFzZSBuYXJyb3cgdGhlIHNlYXJjaCBjcml0ZXJpYWApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gZm91bmQ7XG4gICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgIGlmICghKGVyciBpbnN0YW5jZW9mIENvbnRleHRQcm92aWRlckVycm9yKSAmJiAhKGVyciBpbnN0YW5jZW9mIFplcm9SZXNvdXJjZXNGb3VuZEVycm9yKSkge1xuICAgICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoYEVuY291bnRlcmVkIENDIEFQSSBlcnJvciB3aGlsZSBsaXN0aW5nICR7dHlwZU5hbWV9IHJlc291cmNlcyBtYXRjaGluZyAke0pTT04uc3RyaW5naWZ5KHByb3BlcnR5TWF0Y2gpfTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDb252ZXJ0IGEgQ0MgQVBJIHJlc3BvbnNlIG9iamVjdCBpbnRvIGEgbmljZXIgb2JqZWN0IChwYXJzZSB0aGUgSlNPTilcbiAqL1xuZnVuY3Rpb24gZm91bmRSZXNvdXJjZUZyb21DY0FwaShkZXNjOiBSZXNvdXJjZURlc2NyaXB0aW9uKTogRm91bmRSZXNvdXJjZSB7XG4gIHJldHVybiB7XG4gICAgaWRlbnRpZmllcjogZGVzYy5JZGVudGlmaWVyID8/ICcqTUlTU0lORyonLFxuICAgIHByb3BlcnRpZXM6IEpTT04ucGFyc2UoZGVzYy5Qcm9wZXJ0aWVzID8/ICd7fScpLFxuICB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGdpdmVuIHByb3BlcnR5IHZhbHVlIG1hdGNoZXMgdGhlIGdpdmVuIGZpbHRlclxuICpcbiAqIEZvciBub3cgd2UganVzdCBjaGVjayBmb3Igc3RyaWN0IGVxdWFsaXR5LCBidXQgd2UgY2FuIGltcGxlbWVudCBwYXR0ZXJuIG1hdGNoaW5nIGFuZCBmdXp6eSBtYXRjaGluZyBoZXJlIGxhdGVyXG4gKi9cbmZ1bmN0aW9uIHByb3BlcnR5TWF0Y2hlc0ZpbHRlcihhY3R1YWw6IHVua25vd24sIGV4cGVjdGVkOiB1bmtub3duKSB7XG4gIHJldHVybiBleHBlY3RlZCA9PT0gYWN0dWFsO1xufVxuXG5mdW5jdGlvbiBpc09iamVjdCh4OiB1bmtub3duKTogeCBpcyB7W2tleTogc3RyaW5nXTogdW5rbm93bn0ge1xuICByZXR1cm4gdHlwZW9mIHggPT09ICdvYmplY3QnICYmIHggIT09IG51bGwgJiYgIUFycmF5LmlzQXJyYXkoeCk7XG59XG5cbi8qKlxuICogQSBwYXJzZWQgdmVyc2lvbiBvZiB0aGUgcmV0dXJuIHZhbHVlIGZyb20gQ0NBUElcbiAqL1xuaW50ZXJmYWNlIEZvdW5kUmVzb3VyY2Uge1xuICByZWFkb25seSBpZGVudGlmaWVyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG4vKipcbiAqIEEgc3BlY2lmaWMgbG9va3VwIGZhaWx1cmUgaW5kaWNhdGluZyAwIHJlc291cmNlcyBmb3VuZCB0aGF0IGNhbiBiZSByZWNvdmVyZWRcbiAqL1xuY2xhc3MgWmVyb1Jlc291cmNlc0ZvdW5kRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG59XG4iXX0=