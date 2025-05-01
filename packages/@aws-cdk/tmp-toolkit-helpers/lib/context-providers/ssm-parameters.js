"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSMContextProviderPlugin = void 0;
const aws_auth_1 = require("../api/aws-auth");
const toolkit_error_1 = require("../api/toolkit-error");
/**
 * Plugin to read arbitrary SSM parameter names
 */
class SSMContextProviderPlugin {
    aws;
    io;
    constructor(aws, io) {
        this.aws = aws;
        this.io = io;
    }
    async getValue(args) {
        const region = args.region;
        const account = args.account;
        if (!('parameterName' in args)) {
            throw new toolkit_error_1.ContextProviderError('parameterName must be provided in props for SSMContextProviderPlugin');
        }
        const parameterName = args.parameterName;
        await this.io.debug(`Reading SSM parameter ${account}:${region}:${parameterName}`);
        const response = await this.getSsmParameterValue(args);
        const parameterNotFound = !response.Parameter || response.Parameter.Value === undefined;
        const suppressError = 'ignoreErrorOnMissingContext' in args && args.ignoreErrorOnMissingContext;
        if (parameterNotFound && suppressError && 'dummyValue' in args) {
            return args.dummyValue;
        }
        if (parameterNotFound) {
            throw new toolkit_error_1.ContextProviderError(`SSM parameter not available in account ${account}, region ${region}: ${parameterName}`);
        }
        // will not be undefined because we've handled undefined cases above
        return response.Parameter.Value;
    }
    /**
     * Gets the value of an SSM Parameter, while not throwin if the parameter does not exist.
     * @param account       the account in which the SSM Parameter is expected to be.
     * @param region        the region in which the SSM Parameter is expected to be.
     * @param parameterName the name of the SSM Parameter
     * @param lookupRoleArn the ARN of the lookup role.
     *
     * @returns the result of the ``GetParameter`` operation.
     *
     * @throws Error if a service error (other than ``ParameterNotFound``) occurs.
     */
    async getSsmParameterValue(args) {
        const ssm = (await (0, aws_auth_1.initContextProviderSdk)(this.aws, args)).ssm();
        try {
            return await ssm.getParameter({ Name: args.parameterName });
        }
        catch (e) {
            if (e.name === 'ParameterNotFound') {
                return { $metadata: {} };
            }
            throw e;
        }
    }
}
exports.SSMContextProviderPlugin = SSMContextProviderPlugin;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3NtLXBhcmFtZXRlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvY29udGV4dC1wcm92aWRlcnMvc3NtLXBhcmFtZXRlcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBR0EsOENBQTJFO0FBRTNFLHdEQUE0RDtBQUU1RDs7R0FFRztBQUNILE1BQWEsd0JBQXdCO0lBQ047SUFBbUM7SUFBaEUsWUFBNkIsR0FBZ0IsRUFBbUIsRUFBNEI7UUFBL0QsUUFBRyxHQUFILEdBQUcsQ0FBYTtRQUFtQixPQUFFLEdBQUYsRUFBRSxDQUEwQjtJQUM1RixDQUFDO0lBRU0sS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUE4QjtRQUNsRCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDO1FBQzNCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUM7UUFFN0IsSUFBSSxDQUFDLENBQUMsZUFBZSxJQUFJLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDL0IsTUFBTSxJQUFJLG9DQUFvQixDQUFDLHNFQUFzRSxDQUFDLENBQUM7UUFDekcsQ0FBQztRQUNELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUM7UUFDekMsTUFBTSxJQUFJLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsT0FBTyxJQUFJLE1BQU0sSUFBSSxhQUFhLEVBQUUsQ0FBQyxDQUFDO1FBRW5GLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3ZELE1BQU0saUJBQWlCLEdBQVksQ0FBQyxRQUFRLENBQUMsU0FBUyxJQUFJLFFBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxLQUFLLFNBQVMsQ0FBQztRQUNqRyxNQUFNLGFBQWEsR0FBRyw2QkFBNkIsSUFBSSxJQUFJLElBQUssSUFBSSxDQUFDLDJCQUF1QyxDQUFDO1FBQzdHLElBQUksaUJBQWlCLElBQUksYUFBYSxJQUFJLFlBQVksSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUMvRCxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUM7UUFDekIsQ0FBQztRQUNELElBQUksaUJBQWlCLEVBQUUsQ0FBQztZQUN0QixNQUFNLElBQUksb0NBQW9CLENBQUMsMENBQTBDLE9BQU8sWUFBWSxNQUFNLEtBQUssYUFBYSxFQUFFLENBQUMsQ0FBQztRQUMxSCxDQUFDO1FBQ0Qsb0VBQW9FO1FBQ3BFLE9BQU8sUUFBUSxDQUFDLFNBQVUsQ0FBQyxLQUFLLENBQUM7SUFDbkMsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSyxLQUFLLENBQUMsb0JBQW9CLENBQUMsSUFBOEI7UUFDL0QsTUFBTSxHQUFHLEdBQUcsQ0FBQyxNQUFNLElBQUEsaUNBQXNCLEVBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ2pFLElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDO1FBQzlELENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxtQkFBbUIsRUFBRSxDQUFDO2dCQUNuQyxPQUFPLEVBQUUsU0FBUyxFQUFFLEVBQUUsRUFBRSxDQUFDO1lBQzNCLENBQUM7WUFDRCxNQUFNLENBQUMsQ0FBQztRQUNWLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFqREQsNERBaURDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBTU01QYXJhbWV0ZXJDb250ZXh0UXVlcnkgfSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHR5cGUgeyBHZXRQYXJhbWV0ZXJDb21tYW5kT3V0cHV0IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNzbSc7XG5pbXBvcnQgdHlwZSB7IElDb250ZXh0UHJvdmlkZXJNZXNzYWdlcyB9IGZyb20gJy4nO1xuaW1wb3J0IHsgdHlwZSBTZGtQcm92aWRlciwgaW5pdENvbnRleHRQcm92aWRlclNkayB9IGZyb20gJy4uL2FwaS9hd3MtYXV0aCc7XG5pbXBvcnQgdHlwZSB7IENvbnRleHRQcm92aWRlclBsdWdpbiB9IGZyb20gJy4uL2FwaS9wbHVnaW4nO1xuaW1wb3J0IHsgQ29udGV4dFByb3ZpZGVyRXJyb3IgfSBmcm9tICcuLi9hcGkvdG9vbGtpdC1lcnJvcic7XG5cbi8qKlxuICogUGx1Z2luIHRvIHJlYWQgYXJiaXRyYXJ5IFNTTSBwYXJhbWV0ZXIgbmFtZXNcbiAqL1xuZXhwb3J0IGNsYXNzIFNTTUNvbnRleHRQcm92aWRlclBsdWdpbiBpbXBsZW1lbnRzIENvbnRleHRQcm92aWRlclBsdWdpbiB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgYXdzOiBTZGtQcm92aWRlciwgcHJpdmF0ZSByZWFkb25seSBpbzogSUNvbnRleHRQcm92aWRlck1lc3NhZ2VzKSB7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZ2V0VmFsdWUoYXJnczogU1NNUGFyYW1ldGVyQ29udGV4dFF1ZXJ5KSB7XG4gICAgY29uc3QgcmVnaW9uID0gYXJncy5yZWdpb247XG4gICAgY29uc3QgYWNjb3VudCA9IGFyZ3MuYWNjb3VudDtcblxuICAgIGlmICghKCdwYXJhbWV0ZXJOYW1lJyBpbiBhcmdzKSkge1xuICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKCdwYXJhbWV0ZXJOYW1lIG11c3QgYmUgcHJvdmlkZWQgaW4gcHJvcHMgZm9yIFNTTUNvbnRleHRQcm92aWRlclBsdWdpbicpO1xuICAgIH1cbiAgICBjb25zdCBwYXJhbWV0ZXJOYW1lID0gYXJncy5wYXJhbWV0ZXJOYW1lO1xuICAgIGF3YWl0IHRoaXMuaW8uZGVidWcoYFJlYWRpbmcgU1NNIHBhcmFtZXRlciAke2FjY291bnR9OiR7cmVnaW9ufToke3BhcmFtZXRlck5hbWV9YCk7XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZ2V0U3NtUGFyYW1ldGVyVmFsdWUoYXJncyk7XG4gICAgY29uc3QgcGFyYW1ldGVyTm90Rm91bmQ6IGJvb2xlYW4gPSAhcmVzcG9uc2UuUGFyYW1ldGVyIHx8IHJlc3BvbnNlLlBhcmFtZXRlci5WYWx1ZSA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IHN1cHByZXNzRXJyb3IgPSAnaWdub3JlRXJyb3JPbk1pc3NpbmdDb250ZXh0JyBpbiBhcmdzICYmIChhcmdzLmlnbm9yZUVycm9yT25NaXNzaW5nQ29udGV4dCBhcyBib29sZWFuKTtcbiAgICBpZiAocGFyYW1ldGVyTm90Rm91bmQgJiYgc3VwcHJlc3NFcnJvciAmJiAnZHVtbXlWYWx1ZScgaW4gYXJncykge1xuICAgICAgcmV0dXJuIGFyZ3MuZHVtbXlWYWx1ZTtcbiAgICB9XG4gICAgaWYgKHBhcmFtZXRlck5vdEZvdW5kKSB7XG4gICAgICB0aHJvdyBuZXcgQ29udGV4dFByb3ZpZGVyRXJyb3IoYFNTTSBwYXJhbWV0ZXIgbm90IGF2YWlsYWJsZSBpbiBhY2NvdW50ICR7YWNjb3VudH0sIHJlZ2lvbiAke3JlZ2lvbn06ICR7cGFyYW1ldGVyTmFtZX1gKTtcbiAgICB9XG4gICAgLy8gd2lsbCBub3QgYmUgdW5kZWZpbmVkIGJlY2F1c2Ugd2UndmUgaGFuZGxlZCB1bmRlZmluZWQgY2FzZXMgYWJvdmVcbiAgICByZXR1cm4gcmVzcG9uc2UuUGFyYW1ldGVyIS5WYWx1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSB2YWx1ZSBvZiBhbiBTU00gUGFyYW1ldGVyLCB3aGlsZSBub3QgdGhyb3dpbiBpZiB0aGUgcGFyYW1ldGVyIGRvZXMgbm90IGV4aXN0LlxuICAgKiBAcGFyYW0gYWNjb3VudCAgICAgICB0aGUgYWNjb3VudCBpbiB3aGljaCB0aGUgU1NNIFBhcmFtZXRlciBpcyBleHBlY3RlZCB0byBiZS5cbiAgICogQHBhcmFtIHJlZ2lvbiAgICAgICAgdGhlIHJlZ2lvbiBpbiB3aGljaCB0aGUgU1NNIFBhcmFtZXRlciBpcyBleHBlY3RlZCB0byBiZS5cbiAgICogQHBhcmFtIHBhcmFtZXRlck5hbWUgdGhlIG5hbWUgb2YgdGhlIFNTTSBQYXJhbWV0ZXJcbiAgICogQHBhcmFtIGxvb2t1cFJvbGVBcm4gdGhlIEFSTiBvZiB0aGUgbG9va3VwIHJvbGUuXG4gICAqXG4gICAqIEByZXR1cm5zIHRoZSByZXN1bHQgb2YgdGhlIGBgR2V0UGFyYW1ldGVyYGAgb3BlcmF0aW9uLlxuICAgKlxuICAgKiBAdGhyb3dzIEVycm9yIGlmIGEgc2VydmljZSBlcnJvciAob3RoZXIgdGhhbiBgYFBhcmFtZXRlck5vdEZvdW5kYGApIG9jY3Vycy5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZ2V0U3NtUGFyYW1ldGVyVmFsdWUoYXJnczogU1NNUGFyYW1ldGVyQ29udGV4dFF1ZXJ5KTogUHJvbWlzZTxHZXRQYXJhbWV0ZXJDb21tYW5kT3V0cHV0PiB7XG4gICAgY29uc3Qgc3NtID0gKGF3YWl0IGluaXRDb250ZXh0UHJvdmlkZXJTZGsodGhpcy5hd3MsIGFyZ3MpKS5zc20oKTtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHNzbS5nZXRQYXJhbWV0ZXIoeyBOYW1lOiBhcmdzLnBhcmFtZXRlck5hbWUgfSk7XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICBpZiAoZS5uYW1lID09PSAnUGFyYW1ldGVyTm90Rm91bmQnKSB7XG4gICAgICAgIHJldHVybiB7ICRtZXRhZGF0YToge30gfTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG59XG4iXX0=