"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudFormationStack = void 0;
const util_1 = require("../../util");
const stack_events_1 = require("../stack-events");
const toolkit_error_1 = require("../toolkit-error");
/**
 * Represents an (existing) Stack in CloudFormation
 *
 * Bundle and cache some information that we need during deployment (so we don't have to make
 * repeated calls to CloudFormation).
 */
class CloudFormationStack {
    cfn;
    stackName;
    stack;
    retrieveProcessedTemplate;
    static async lookup(cfn, stackName, retrieveProcessedTemplate = false) {
        try {
            const response = await cfn.describeStacks({ StackName: stackName });
            return new CloudFormationStack(cfn, stackName, response.Stacks && response.Stacks[0], retrieveProcessedTemplate);
        }
        catch (e) {
            if (e.name === 'ValidationError' && (0, util_1.formatErrorMessage)(e) === `Stack with id ${stackName} does not exist`) {
                return new CloudFormationStack(cfn, stackName, undefined);
            }
            throw e;
        }
    }
    /**
     * Return a copy of the given stack that does not exist
     *
     * It's a little silly that it needs arguments to do that, but there we go.
     */
    static doesNotExist(cfn, stackName) {
        return new CloudFormationStack(cfn, stackName);
    }
    /**
     * From static information (for testing)
     */
    static fromStaticInformation(cfn, stackName, stack) {
        return new CloudFormationStack(cfn, stackName, stack);
    }
    _template;
    constructor(cfn, stackName, stack, retrieveProcessedTemplate = false) {
        this.cfn = cfn;
        this.stackName = stackName;
        this.stack = stack;
        this.retrieveProcessedTemplate = retrieveProcessedTemplate;
    }
    /**
     * Retrieve the stack's deployed template
     *
     * Cached, so will only be retrieved once. Will return an empty
     * structure if the stack does not exist.
     */
    async template() {
        if (!this.exists) {
            return {};
        }
        if (this._template === undefined) {
            const response = await this.cfn.getTemplate({
                StackName: this.stackName,
                TemplateStage: this.retrieveProcessedTemplate ? 'Processed' : 'Original',
            });
            this._template = (response.TemplateBody && (0, util_1.deserializeStructure)(response.TemplateBody)) || {};
        }
        return this._template;
    }
    /**
     * Whether the stack exists
     */
    get exists() {
        return this.stack !== undefined;
    }
    /**
     * The stack's ID (which is the same as its ARN)
     *
     * Throws if the stack doesn't exist.
     */
    get stackId() {
        this.assertExists();
        return this.stack.StackId;
    }
    /**
     * The stack's current outputs
     *
     * Empty object if the stack doesn't exist
     */
    get outputs() {
        if (!this.exists) {
            return {};
        }
        const result = {};
        (this.stack.Outputs || []).forEach((output) => {
            result[output.OutputKey] = output.OutputValue;
        });
        return result;
    }
    /**
     * The stack's status
     *
     * Special status NOT_FOUND if the stack does not exist.
     */
    get stackStatus() {
        if (!this.exists) {
            return new stack_events_1.StackStatus('NOT_FOUND', 'Stack not found during lookup');
        }
        return stack_events_1.StackStatus.fromStackDescription(this.stack);
    }
    /**
     * The stack's current tags
     *
     * Empty list if the stack does not exist
     */
    get tags() {
        return this.stack?.Tags || [];
    }
    /**
     * SNS Topic ARNs that will receive stack events.
     *
     * Empty list if the stack does not exist
     */
    get notificationArns() {
        return this.stack?.NotificationARNs ?? [];
    }
    /**
     * Return the names of all current parameters to the stack
     *
     * Empty list if the stack does not exist.
     */
    get parameterNames() {
        return Object.keys(this.parameters);
    }
    /**
     * Return the names and values of all current parameters to the stack
     *
     * Empty object if the stack does not exist.
     */
    get parameters() {
        if (!this.exists) {
            return {};
        }
        const ret = {};
        for (const param of this.stack.Parameters ?? []) {
            ret[param.ParameterKey] = param.ResolvedValue ?? param.ParameterValue;
        }
        return ret;
    }
    /**
     * Return the termination protection of the stack
     */
    get terminationProtection() {
        return this.stack?.EnableTerminationProtection;
    }
    assertExists() {
        if (!this.exists) {
            throw new toolkit_error_1.ToolkitError(`No stack named '${this.stackName}'`);
        }
    }
}
exports.CloudFormationStack = CloudFormationStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2staGVscGVycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvY2xvdWRmb3JtYXRpb24vc3RhY2staGVscGVycy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxxQ0FBc0U7QUFFdEUsa0RBQThDO0FBQzlDLG9EQUFnRDtBQWNoRDs7Ozs7R0FLRztBQUNILE1BQWEsbUJBQW1CO0lBb0NYO0lBQ0Q7SUFDQztJQUNBO0lBdENaLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUN4QixHQUEwQixFQUMxQixTQUFpQixFQUNqQiw0QkFBcUMsS0FBSztRQUUxQyxJQUFJLENBQUM7WUFDSCxNQUFNLFFBQVEsR0FBRyxNQUFNLEdBQUcsQ0FBQyxjQUFjLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztZQUNwRSxPQUFPLElBQUksbUJBQW1CLENBQUMsR0FBRyxFQUFFLFNBQVMsRUFBRSxRQUFRLENBQUMsTUFBTSxJQUFJLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUseUJBQXlCLENBQUMsQ0FBQztRQUNuSCxDQUFDO1FBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztZQUNoQixJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssaUJBQWlCLElBQUksSUFBQSx5QkFBa0IsRUFBQyxDQUFDLENBQUMsS0FBSyxpQkFBaUIsU0FBUyxpQkFBaUIsRUFBRSxDQUFDO2dCQUMxRyxPQUFPLElBQUksbUJBQW1CLENBQUMsR0FBRyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUM1RCxDQUFDO1lBQ0QsTUFBTSxDQUFDLENBQUM7UUFDVixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxNQUFNLENBQUMsWUFBWSxDQUFDLEdBQTBCLEVBQUUsU0FBaUI7UUFDdEUsT0FBTyxJQUFJLG1CQUFtQixDQUFDLEdBQUcsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUNqRCxDQUFDO0lB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QyxDQUFDO0lBQ3RDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsSUFBVyxVQUFVO1FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDakIsT0FBTyxFQUFFLENBQUM7UUFDWixDQUFDO1FBQ0QsTUFBTSxHQUFHLEdBQTJCLEVBQUUsQ0FBQztRQUN2QyxLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksQ0FBQyxLQUFNLENBQUMsVUFBVSxJQUFJLEVBQUUsRUFBRSxDQUFDO1lBQ2pELEdBQUcsQ0FBQyxLQUFLLENBQUMsWUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFDLGFBQWEsSUFBSSxLQUFLLENBQUMsY0FBZSxDQUFDO1FBQzFFLENBQUM7UUFDRCxPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUM7SUFFRDs7T0FFRztJQUNILElBQVcscUJBQXFCO1FBQzlCLE9BQU8sSUFBSSxDQUFDLEtBQUssRUFBRSwyQkFBMkIsQ0FBQztJQUNqRCxDQUFDO0lBRU8sWUFBWTtRQUNsQixJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ2pCLE1BQU0sSUFBSSw0QkFBWSxDQUFDLG1CQUFtQixJQUFJLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQztRQUMvRCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBcEtELGtEQW9LQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgU3RhY2ssIFRhZyB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgeyBmb3JtYXRFcnJvck1lc3NhZ2UsIGRlc2VyaWFsaXplU3RydWN0dXJlIH0gZnJvbSAnLi4vLi4vdXRpbCc7XG5pbXBvcnQgdHlwZSB7IElDbG91ZEZvcm1hdGlvbkNsaWVudCB9IGZyb20gJy4uL2F3cy1hdXRoJztcbmltcG9ydCB7IFN0YWNrU3RhdHVzIH0gZnJvbSAnLi4vc3RhY2stZXZlbnRzJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4uL3Rvb2xraXQtZXJyb3InO1xuXG5leHBvcnQgaW50ZXJmYWNlIFRlbXBsYXRlIHtcbiAgUGFyYW1ldGVycz86IFJlY29yZDxzdHJpbmcsIFRlbXBsYXRlUGFyYW1ldGVyPjtcbiAgW3NlY3Rpb246IHN0cmluZ106IGFueTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBUZW1wbGF0ZVBhcmFtZXRlciB7XG4gIFR5cGU6IHN0cmluZztcbiAgRGVmYXVsdD86IGFueTtcbiAgRGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gIFtrZXk6IHN0cmluZ106IGFueTtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIGFuIChleGlzdGluZykgU3RhY2sgaW4gQ2xvdWRGb3JtYXRpb25cbiAqXG4gKiBCdW5kbGUgYW5kIGNhY2hlIHNvbWUgaW5mb3JtYXRpb24gdGhhdCB3ZSBuZWVkIGR1cmluZyBkZXBsb3ltZW50IChzbyB3ZSBkb24ndCBoYXZlIHRvIG1ha2VcbiAqIHJlcGVhdGVkIGNhbGxzIHRvIENsb3VkRm9ybWF0aW9uKS5cbiAqL1xuZXhwb3J0IGNsYXNzIENsb3VkRm9ybWF0aW9uU3RhY2sge1xuICBwdWJsaWMgc3RhdGljIGFzeW5jIGxvb2t1cChcbiAgICBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgICBzdGFja05hbWU6IHN0cmluZyxcbiAgICByZXRyaWV2ZVByb2Nlc3NlZFRlbXBsYXRlOiBib29sZWFuID0gZmFsc2UsXG4gICk6IFByb21pc2U8Q2xvdWRGb3JtYXRpb25TdGFjaz4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNmbi5kZXNjcmliZVN0YWNrcyh7IFN0YWNrTmFtZTogc3RhY2tOYW1lIH0pO1xuICAgICAgcmV0dXJuIG5ldyBDbG91ZEZvcm1hdGlvblN0YWNrKGNmbiwgc3RhY2tOYW1lLCByZXNwb25zZS5TdGFja3MgJiYgcmVzcG9uc2UuU3RhY2tzWzBdLCByZXRyaWV2ZVByb2Nlc3NlZFRlbXBsYXRlKTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIGlmIChlLm5hbWUgPT09ICdWYWxpZGF0aW9uRXJyb3InICYmIGZvcm1hdEVycm9yTWVzc2FnZShlKSA9PT0gYFN0YWNrIHdpdGggaWQgJHtzdGFja05hbWV9IGRvZXMgbm90IGV4aXN0YCkge1xuICAgICAgICByZXR1cm4gbmV3IENsb3VkRm9ybWF0aW9uU3RhY2soY2ZuLCBzdGFja05hbWUsIHVuZGVmaW5lZCk7XG4gICAgICB9XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gYSBjb3B5IG9mIHRoZSBnaXZlbiBzdGFjayB0aGF0IGRvZXMgbm90IGV4aXN0XG4gICAqXG4gICAqIEl0J3MgYSBsaXR0bGUgc2lsbHkgdGhhdCBpdCBuZWVkcyBhcmd1bWVudHMgdG8gZG8gdGhhdCwgYnV0IHRoZXJlIHdlIGdvLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBkb2VzTm90RXhpc3QoY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQsIHN0YWNrTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIG5ldyBDbG91ZEZvcm1hdGlvblN0YWNrKGNmbiwgc3RhY2tOYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGcm9tIHN0YXRpYyBpbmZvcm1hdGlvbiAoZm9yIHRlc3RpbmcpXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21TdGF0aWNJbmZvcm1hdGlvbihjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCwgc3RhY2tOYW1lOiBzdHJpbmcsIHN0YWNrOiBTdGFjaykge1xuICAgIHJldHVybiBuZXcgQ2xvdWRGb3JtYXRpb25TdGFjayhjZm4sIHN0YWNrTmFtZSwgc3RhY2spO1xuICB9XG5cbiAgcHJpdmF0ZSBfdGVtcGxhdGU6IGFueTtcblxuICBwcm90ZWN0ZWQgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgICBwdWJsaWMgcmVhZG9ubHkgc3RhY2tOYW1lOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBzdGFjaz86IFN0YWNrLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmV0cmlldmVQcm9jZXNzZWRUZW1wbGF0ZTogYm9vbGVhbiA9IGZhbHNlLFxuICApIHtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZSB0aGUgc3RhY2sncyBkZXBsb3llZCB0ZW1wbGF0ZVxuICAgKlxuICAgKiBDYWNoZWQsIHNvIHdpbGwgb25seSBiZSByZXRyaWV2ZWQgb25jZS4gV2lsbCByZXR1cm4gYW4gZW1wdHlcbiAgICogc3RydWN0dXJlIGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdC5cbiAgICovXG4gIHB1YmxpYyBhc3luYyB0ZW1wbGF0ZSgpOiBQcm9taXNlPFRlbXBsYXRlPiB7XG4gICAgaWYgKCF0aGlzLmV4aXN0cykge1xuICAgICAgcmV0dXJuIHt9O1xuICAgIH1cblxuICAgIGlmICh0aGlzLl90ZW1wbGF0ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2ZuLmdldFRlbXBsYXRlKHtcbiAgICAgICAgU3RhY2tOYW1lOiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgICAgVGVtcGxhdGVTdGFnZTogdGhpcy5yZXRyaWV2ZVByb2Nlc3NlZFRlbXBsYXRlID8gJ1Byb2Nlc3NlZCcgOiAnT3JpZ2luYWwnLFxuICAgICAgfSk7XG4gICAgICB0aGlzLl90ZW1wbGF0ZSA9IChyZXNwb25zZS5UZW1wbGF0ZUJvZHkgJiYgZGVzZXJpYWxpemVTdHJ1Y3R1cmUocmVzcG9uc2UuVGVtcGxhdGVCb2R5KSkgfHwge307XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl90ZW1wbGF0ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBzdGFjayBleGlzdHNcbiAgICovXG4gIHB1YmxpYyBnZXQgZXhpc3RzKCkge1xuICAgIHJldHVybiB0aGlzLnN0YWNrICE9PSB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogVGhlIHN0YWNrJ3MgSUQgKHdoaWNoIGlzIHRoZSBzYW1lIGFzIGl0cyBBUk4pXG4gICAqXG4gICAqIFRocm93cyBpZiB0aGUgc3RhY2sgZG9lc24ndCBleGlzdC5cbiAgICovXG4gIHB1YmxpYyBnZXQgc3RhY2tJZCgpIHtcbiAgICB0aGlzLmFzc2VydEV4aXN0cygpO1xuICAgIHJldHVybiB0aGlzLnN0YWNrIS5TdGFja0lkITtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgc3RhY2sncyBjdXJyZW50IG91dHB1dHNcbiAgICpcbiAgICogRW1wdHkgb2JqZWN0IGlmIHRoZSBzdGFjayBkb2Vzbid0IGV4aXN0XG4gICAqL1xuICBwdWJsaWMgZ2V0IG91dHB1dHMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgaWYgKCF0aGlzLmV4aXN0cykge1xuICAgICAgcmV0dXJuIHt9O1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQ6IHsgW25hbWU6IHN0cmluZ106IHN0cmluZyB9ID0ge307XG4gICAgKHRoaXMuc3RhY2shLk91dHB1dHMgfHwgW10pLmZvckVhY2goKG91dHB1dCkgPT4ge1xuICAgICAgcmVzdWx0W291dHB1dC5PdXRwdXRLZXkhXSA9IG91dHB1dC5PdXRwdXRWYWx1ZSE7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgc3RhY2sncyBzdGF0dXNcbiAgICpcbiAgICogU3BlY2lhbCBzdGF0dXMgTk9UX0ZPVU5EIGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdC5cbiAgICovXG4gIHB1YmxpYyBnZXQgc3RhY2tTdGF0dXMoKTogU3RhY2tTdGF0dXMge1xuICAgIGlmICghdGhpcy5leGlzdHMpIHtcbiAgICAgIHJldHVybiBuZXcgU3RhY2tTdGF0dXMoJ05PVF9GT1VORCcsICdTdGFjayBub3QgZm91bmQgZHVyaW5nIGxvb2t1cCcpO1xuICAgIH1cbiAgICByZXR1cm4gU3RhY2tTdGF0dXMuZnJvbVN0YWNrRGVzY3JpcHRpb24odGhpcy5zdGFjayEpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBzdGFjaydzIGN1cnJlbnQgdGFnc1xuICAgKlxuICAgKiBFbXB0eSBsaXN0IGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdFxuICAgKi9cbiAgcHVibGljIGdldCB0YWdzKCk6IFRhZ1tdIHtcbiAgICByZXR1cm4gdGhpcy5zdGFjaz8uVGFncyB8fCBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTTlMgVG9waWMgQVJOcyB0aGF0IHdpbGwgcmVjZWl2ZSBzdGFjayBldmVudHMuXG4gICAqXG4gICAqIEVtcHR5IGxpc3QgaWYgdGhlIHN0YWNrIGRvZXMgbm90IGV4aXN0XG4gICAqL1xuICBwdWJsaWMgZ2V0IG5vdGlmaWNhdGlvbkFybnMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiB0aGlzLnN0YWNrPy5Ob3RpZmljYXRpb25BUk5zID8/IFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiB0aGUgbmFtZXMgb2YgYWxsIGN1cnJlbnQgcGFyYW1ldGVycyB0byB0aGUgc3RhY2tcbiAgICpcbiAgICogRW1wdHkgbGlzdCBpZiB0aGUgc3RhY2sgZG9lcyBub3QgZXhpc3QuXG4gICAqL1xuICBwdWJsaWMgZ2V0IHBhcmFtZXRlck5hbWVzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5wYXJhbWV0ZXJzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gdGhlIG5hbWVzIGFuZCB2YWx1ZXMgb2YgYWxsIGN1cnJlbnQgcGFyYW1ldGVycyB0byB0aGUgc3RhY2tcbiAgICpcbiAgICogRW1wdHkgb2JqZWN0IGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdC5cbiAgICovXG4gIHB1YmxpYyBnZXQgcGFyYW1ldGVycygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICBpZiAoIXRoaXMuZXhpc3RzKSB7XG4gICAgICByZXR1cm4ge307XG4gICAgfVxuICAgIGNvbnN0IHJldDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgIGZvciAoY29uc3QgcGFyYW0gb2YgdGhpcy5zdGFjayEuUGFyYW1ldGVycyA/PyBbXSkge1xuICAgICAgcmV0W3BhcmFtLlBhcmFtZXRlcktleSFdID0gcGFyYW0uUmVzb2x2ZWRWYWx1ZSA/PyBwYXJhbS5QYXJhbWV0ZXJWYWx1ZSE7XG4gICAgfVxuICAgIHJldHVybiByZXQ7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHRoZSB0ZXJtaW5hdGlvbiBwcm90ZWN0aW9uIG9mIHRoZSBzdGFja1xuICAgKi9cbiAgcHVibGljIGdldCB0ZXJtaW5hdGlvblByb3RlY3Rpb24oKTogYm9vbGVhbiB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuc3RhY2s/LkVuYWJsZVRlcm1pbmF0aW9uUHJvdGVjdGlvbjtcbiAgfVxuXG4gIHByaXZhdGUgYXNzZXJ0RXhpc3RzKCkge1xuICAgIGlmICghdGhpcy5leGlzdHMpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYE5vIHN0YWNrIG5hbWVkICcke3RoaXMuc3RhY2tOYW1lfSdgKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==