"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyContextProviderPlugin = void 0;
const aws_auth_1 = require("../api/aws-auth");
const toolkit_error_1 = require("../api/toolkit-error");
class KeyContextProviderPlugin {
    aws;
    io;
    constructor(aws, io) {
        this.aws = aws;
        this.io = io;
    }
    async getValue(args) {
        const kms = (await (0, aws_auth_1.initContextProviderSdk)(this.aws, args)).kms();
        const aliasListEntry = await this.findKey(kms, args);
        return this.readKeyProps(aliasListEntry, args);
    }
    // TODO: use paginator function
    async findKey(kms, args) {
        await this.io.debug(`Listing keys in ${args.account}:${args.region}`);
        let response;
        let nextMarker;
        do {
            response = await kms.listAliases({
                Marker: nextMarker,
            });
            const aliases = response.Aliases || [];
            for (const alias of aliases) {
                if (alias.AliasName == args.aliasName) {
                    return alias;
                }
            }
            nextMarker = response.NextMarker;
        } while (nextMarker);
        const suppressError = 'ignoreErrorOnMissingContext' in args && args.ignoreErrorOnMissingContext;
        const hasDummyKeyId = 'dummyValue' in args && typeof args.dummyValue === 'object' && args.dummyValue !== null && 'keyId' in args.dummyValue;
        if (suppressError && hasDummyKeyId) {
            const keyId = args.dummyValue.keyId;
            return { TargetKeyId: keyId };
        }
        throw new toolkit_error_1.ContextProviderError(`Could not find any key with alias named ${args.aliasName}`);
    }
    async readKeyProps(alias, args) {
        if (!alias.TargetKeyId) {
            throw new toolkit_error_1.ContextProviderError(`Could not find any key with alias named ${args.aliasName}`);
        }
        await this.io.debug(`Key found ${alias.TargetKeyId}`);
        return {
            keyId: alias.TargetKeyId,
        };
    }
}
exports.KeyContextProviderPlugin = KeyContextProviderPlugin;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoia2V5cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9jb250ZXh0LXByb3ZpZGVycy9rZXlzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUtBLDhDQUF5RDtBQUV6RCx3REFBNEQ7QUFFNUQsTUFBYSx3QkFBd0I7SUFDTjtJQUFtQztJQUFoRSxZQUE2QixHQUFnQixFQUFtQixFQUE0QjtRQUEvRCxRQUFHLEdBQUgsR0FBRyxDQUFhO1FBQW1CLE9BQUUsR0FBRixFQUFFLENBQTBCO0lBQzVGLENBQUM7SUFFTSxLQUFLLENBQUMsUUFBUSxDQUFDLElBQXFCO1FBQ3pDLE1BQU0sR0FBRyxHQUFHLENBQUMsTUFBTSxJQUFBLGlDQUFzQixFQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUVqRSxNQUFNLGNBQWMsR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRXJELE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDakQsQ0FBQztJQUVELCtCQUErQjtJQUN2QixLQUFLLENBQUMsT0FBTyxDQUFDLEdBQWUsRUFBRSxJQUFxQjtRQUMxRCxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLG1CQUFtQixJQUFJLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBRXRFLElBQUksUUFBa0MsQ0FBQztRQUN2QyxJQUFJLFVBQThCLENBQUM7UUFDbkMsR0FBRyxDQUFDO1lBQ0YsUUFBUSxHQUFHLE1BQU0sR0FBRyxDQUFDLFdBQVcsQ0FBQztnQkFDL0IsTUFBTSxFQUFFLFVBQVU7YUFDbkIsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUM7WUFDdkMsS0FBSyxNQUFNLEtBQUssSUFBSSxPQUFPLEVBQUUsQ0FBQztnQkFDNUIsSUFBSSxLQUFLLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztvQkFDdEMsT0FBTyxLQUFLLENBQUM7Z0JBQ2YsQ0FBQztZQUNILENBQUM7WUFFRCxVQUFVLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQztRQUNuQyxDQUFDLFFBQVEsVUFBVSxFQUFFO1FBRXJCLE1BQU0sYUFBYSxHQUFHLDZCQUE2QixJQUFJLElBQUksSUFBSSxJQUFJLENBQUMsMkJBQXNDLENBQUM7UUFDM0csTUFBTSxhQUFhLEdBQUcsWUFBWSxJQUFJLElBQUksSUFBSSxPQUFPLElBQUksQ0FBQyxVQUFVLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxVQUFVLEtBQUssSUFBSSxJQUFJLE9BQU8sSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDO1FBQzVJLElBQUksYUFBYSxJQUFJLGFBQWEsRUFBRSxDQUFDO1lBQ25DLE1BQU0sS0FBSyxHQUFJLElBQUksQ0FBQyxVQUFnQyxDQUFDLEtBQUssQ0FBQztZQUMzRCxPQUFPLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxDQUFDO1FBQ2hDLENBQUM7UUFDRCxNQUFNLElBQUksb0NBQW9CLENBQUMsMkNBQTJDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO0lBQzlGLENBQUM7SUFFTyxLQUFLLENBQUMsWUFBWSxDQUFDLEtBQXFCLEVBQUUsSUFBcUI7UUFDckUsSUFBSSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUN2QixNQUFNLElBQUksb0NBQW9CLENBQUMsMkNBQTJDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQzlGLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLGFBQWEsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFFdEQsT0FBTztZQUNMLEtBQUssRUFBRSxLQUFLLENBQUMsV0FBVztTQUN6QixDQUFDO0lBQ0osQ0FBQztDQUNGO0FBckRELDREQXFEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgS2V5Q29udGV4dFF1ZXJ5IH0gZnJvbSAnQGF3cy1jZGsvY2xvdWQtYXNzZW1ibHktc2NoZW1hJztcbmltcG9ydCB0eXBlIHsgS2V5Q29udGV4dFJlc3BvbnNlIH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB0eXBlIHsgQWxpYXNMaXN0RW50cnksIExpc3RBbGlhc2VzQ29tbWFuZE91dHB1dCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1rbXMnO1xuaW1wb3J0IHR5cGUgeyBJQ29udGV4dFByb3ZpZGVyTWVzc2FnZXMgfSBmcm9tICcuJztcbmltcG9ydCB0eXBlIHsgSUtNU0NsaWVudCwgU2RrUHJvdmlkZXIgfSBmcm9tICcuLi9hcGkvYXdzLWF1dGgnO1xuaW1wb3J0IHsgaW5pdENvbnRleHRQcm92aWRlclNkayB9IGZyb20gJy4uL2FwaS9hd3MtYXV0aCc7XG5pbXBvcnQgdHlwZSB7IENvbnRleHRQcm92aWRlclBsdWdpbiB9IGZyb20gJy4uL2FwaS9wbHVnaW4nO1xuaW1wb3J0IHsgQ29udGV4dFByb3ZpZGVyRXJyb3IgfSBmcm9tICcuLi9hcGkvdG9vbGtpdC1lcnJvcic7XG5cbmV4cG9ydCBjbGFzcyBLZXlDb250ZXh0UHJvdmlkZXJQbHVnaW4gaW1wbGVtZW50cyBDb250ZXh0UHJvdmlkZXJQbHVnaW4ge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGF3czogU2RrUHJvdmlkZXIsIHByaXZhdGUgcmVhZG9ubHkgaW86IElDb250ZXh0UHJvdmlkZXJNZXNzYWdlcykge1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGdldFZhbHVlKGFyZ3M6IEtleUNvbnRleHRRdWVyeSkge1xuICAgIGNvbnN0IGttcyA9IChhd2FpdCBpbml0Q29udGV4dFByb3ZpZGVyU2RrKHRoaXMuYXdzLCBhcmdzKSkua21zKCk7XG5cbiAgICBjb25zdCBhbGlhc0xpc3RFbnRyeSA9IGF3YWl0IHRoaXMuZmluZEtleShrbXMsIGFyZ3MpO1xuXG4gICAgcmV0dXJuIHRoaXMucmVhZEtleVByb3BzKGFsaWFzTGlzdEVudHJ5LCBhcmdzKTtcbiAgfVxuXG4gIC8vIFRPRE86IHVzZSBwYWdpbmF0b3IgZnVuY3Rpb25cbiAgcHJpdmF0ZSBhc3luYyBmaW5kS2V5KGttczogSUtNU0NsaWVudCwgYXJnczogS2V5Q29udGV4dFF1ZXJ5KTogUHJvbWlzZTxBbGlhc0xpc3RFbnRyeT4ge1xuICAgIGF3YWl0IHRoaXMuaW8uZGVidWcoYExpc3Rpbmcga2V5cyBpbiAke2FyZ3MuYWNjb3VudH06JHthcmdzLnJlZ2lvbn1gKTtcblxuICAgIGxldCByZXNwb25zZTogTGlzdEFsaWFzZXNDb21tYW5kT3V0cHV0O1xuICAgIGxldCBuZXh0TWFya2VyOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgZG8ge1xuICAgICAgcmVzcG9uc2UgPSBhd2FpdCBrbXMubGlzdEFsaWFzZXMoe1xuICAgICAgICBNYXJrZXI6IG5leHRNYXJrZXIsXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgYWxpYXNlcyA9IHJlc3BvbnNlLkFsaWFzZXMgfHwgW107XG4gICAgICBmb3IgKGNvbnN0IGFsaWFzIG9mIGFsaWFzZXMpIHtcbiAgICAgICAgaWYgKGFsaWFzLkFsaWFzTmFtZSA9PSBhcmdzLmFsaWFzTmFtZSkge1xuICAgICAgICAgIHJldHVybiBhbGlhcztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBuZXh0TWFya2VyID0gcmVzcG9uc2UuTmV4dE1hcmtlcjtcbiAgICB9IHdoaWxlIChuZXh0TWFya2VyKTtcblxuICAgIGNvbnN0IHN1cHByZXNzRXJyb3IgPSAnaWdub3JlRXJyb3JPbk1pc3NpbmdDb250ZXh0JyBpbiBhcmdzICYmIGFyZ3MuaWdub3JlRXJyb3JPbk1pc3NpbmdDb250ZXh0IGFzIGJvb2xlYW47XG4gICAgY29uc3QgaGFzRHVtbXlLZXlJZCA9ICdkdW1teVZhbHVlJyBpbiBhcmdzICYmIHR5cGVvZiBhcmdzLmR1bW15VmFsdWUgPT09ICdvYmplY3QnICYmIGFyZ3MuZHVtbXlWYWx1ZSAhPT0gbnVsbCAmJiAna2V5SWQnIGluIGFyZ3MuZHVtbXlWYWx1ZTtcbiAgICBpZiAoc3VwcHJlc3NFcnJvciAmJiBoYXNEdW1teUtleUlkKSB7XG4gICAgICBjb25zdCBrZXlJZCA9IChhcmdzLmR1bW15VmFsdWUgYXMgeyBrZXlJZDogc3RyaW5nIH0pLmtleUlkO1xuICAgICAgcmV0dXJuIHsgVGFyZ2V0S2V5SWQ6IGtleUlkIH07XG4gICAgfVxuICAgIHRocm93IG5ldyBDb250ZXh0UHJvdmlkZXJFcnJvcihgQ291bGQgbm90IGZpbmQgYW55IGtleSB3aXRoIGFsaWFzIG5hbWVkICR7YXJncy5hbGlhc05hbWV9YCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRLZXlQcm9wcyhhbGlhczogQWxpYXNMaXN0RW50cnksIGFyZ3M6IEtleUNvbnRleHRRdWVyeSk6IFByb21pc2U8S2V5Q29udGV4dFJlc3BvbnNlPiB7XG4gICAgaWYgKCFhbGlhcy5UYXJnZXRLZXlJZCkge1xuICAgICAgdGhyb3cgbmV3IENvbnRleHRQcm92aWRlckVycm9yKGBDb3VsZCBub3QgZmluZCBhbnkga2V5IHdpdGggYWxpYXMgbmFtZWQgJHthcmdzLmFsaWFzTmFtZX1gKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmlvLmRlYnVnKGBLZXkgZm91bmQgJHthbGlhcy5UYXJnZXRLZXlJZH1gKTtcblxuICAgIHJldHVybiB7XG4gICAgICBrZXlJZDogYWxpYXMuVGFyZ2V0S2V5SWQsXG4gICAgfTtcbiAgfVxufVxuIl19