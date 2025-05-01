"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceEnvPlaceholders = replaceEnvPlaceholders;
const cx_api_1 = require("@aws-cdk/cx-api");
const plugin_1 = require("../plugin");
/**
 * Replace the {ACCOUNT} and {REGION} placeholders in all strings found in a complex object.
 */
async function replaceEnvPlaceholders(object, env, sdkProvider) {
    return cx_api_1.EnvironmentPlaceholders.replaceAsync(object, {
        accountId: () => Promise.resolve(env.account),
        region: () => Promise.resolve(env.region),
        partition: async () => {
            // There's no good way to get the partition!
            // We should have had it already, except we don't.
            //
            // Best we can do is ask the "base credentials" for this environment for their partition. Cross-partition
            // AssumeRole'ing will never work anyway, so this answer won't be wrong (it will just be slow!)
            return (await sdkProvider.baseCredentialsPartition(env, plugin_1.Mode.ForReading)) ?? 'aws';
        },
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhY2Vob2xkZXJzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9lbnZpcm9ubWVudC9wbGFjZWhvbGRlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFRQSx3REFpQkM7QUF6QkQsNENBQTRFO0FBRzVFLHNDQUFpQztBQUVqQzs7R0FFRztBQUNJLEtBQUssVUFBVSxzQkFBc0IsQ0FDMUMsTUFBUyxFQUNULEdBQWdCLEVBQ2hCLFdBQXdCO0lBRXhCLE9BQU8sZ0NBQXVCLENBQUMsWUFBWSxDQUFDLE1BQU0sRUFBRTtRQUNsRCxTQUFTLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO1FBQzdDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7UUFDekMsU0FBUyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3BCLDRDQUE0QztZQUM1QyxrREFBa0Q7WUFDbEQsRUFBRTtZQUNGLHlHQUF5RztZQUN6RywrRkFBK0Y7WUFDL0YsT0FBTyxDQUFDLE1BQU0sV0FBVyxDQUFDLHdCQUF3QixDQUFDLEdBQUcsRUFBRSxhQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUM7UUFDckYsQ0FBQztLQUNGLENBQUMsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB0eXBlIEVudmlyb25tZW50LCBFbnZpcm9ubWVudFBsYWNlaG9sZGVycyB9IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgdHlwZSB7IEJyYW5kZWQgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB0eXBlIHsgU2RrUHJvdmlkZXIgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgeyBNb2RlIH0gZnJvbSAnLi4vcGx1Z2luJztcblxuLyoqXG4gKiBSZXBsYWNlIHRoZSB7QUNDT1VOVH0gYW5kIHtSRUdJT059IHBsYWNlaG9sZGVycyBpbiBhbGwgc3RyaW5ncyBmb3VuZCBpbiBhIGNvbXBsZXggb2JqZWN0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVwbGFjZUVudlBsYWNlaG9sZGVyczxBIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPj4oXG4gIG9iamVjdDogQSxcbiAgZW52OiBFbnZpcm9ubWVudCxcbiAgc2RrUHJvdmlkZXI6IFNka1Byb3ZpZGVyLFxuKTogUHJvbWlzZTx7W2sgaW4ga2V5b2YgQV06IFN0cmluZ1dpdGhvdXRQbGFjZWhvbGRlcnMgfCB1bmRlZmluZWR9PiB7XG4gIHJldHVybiBFbnZpcm9ubWVudFBsYWNlaG9sZGVycy5yZXBsYWNlQXN5bmMob2JqZWN0LCB7XG4gICAgYWNjb3VudElkOiAoKSA9PiBQcm9taXNlLnJlc29sdmUoZW52LmFjY291bnQpLFxuICAgIHJlZ2lvbjogKCkgPT4gUHJvbWlzZS5yZXNvbHZlKGVudi5yZWdpb24pLFxuICAgIHBhcnRpdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gVGhlcmUncyBubyBnb29kIHdheSB0byBnZXQgdGhlIHBhcnRpdGlvbiFcbiAgICAgIC8vIFdlIHNob3VsZCBoYXZlIGhhZCBpdCBhbHJlYWR5LCBleGNlcHQgd2UgZG9uJ3QuXG4gICAgICAvL1xuICAgICAgLy8gQmVzdCB3ZSBjYW4gZG8gaXMgYXNrIHRoZSBcImJhc2UgY3JlZGVudGlhbHNcIiBmb3IgdGhpcyBlbnZpcm9ubWVudCBmb3IgdGhlaXIgcGFydGl0aW9uLiBDcm9zcy1wYXJ0aXRpb25cbiAgICAgIC8vIEFzc3VtZVJvbGUnaW5nIHdpbGwgbmV2ZXIgd29yayBhbnl3YXksIHNvIHRoaXMgYW5zd2VyIHdvbid0IGJlIHdyb25nIChpdCB3aWxsIGp1c3QgYmUgc2xvdyEpXG4gICAgICByZXR1cm4gKGF3YWl0IHNka1Byb3ZpZGVyLmJhc2VDcmVkZW50aWFsc1BhcnRpdGlvbihlbnYsIE1vZGUuRm9yUmVhZGluZykpID8/ICdhd3MnO1xuICAgIH0sXG4gIH0pO1xufVxuXG5leHBvcnQgdHlwZSBTdHJpbmdXaXRob3V0UGxhY2Vob2xkZXJzID0gQnJhbmRlZDxzdHJpbmcsICdOb1BsYWNlaG9sZGVycyc+O1xuIl19