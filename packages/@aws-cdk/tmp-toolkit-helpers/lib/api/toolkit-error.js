"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextProviderError = exports.AssemblyError = exports.AuthenticationError = exports.ToolkitError = void 0;
const TOOLKIT_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.ToolkitError');
const AUTHENTICATION_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.AuthenticationError');
const ASSEMBLY_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.AssemblyError');
const CONTEXT_PROVIDER_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.ContextProviderError');
/**
 * Represents a general toolkit error in the AWS CDK Toolkit.
 */
class ToolkitError extends Error {
    /**
     * Determines if a given error is an instance of ToolkitError.
     */
    static isToolkitError(x) {
        return x !== null && typeof (x) === 'object' && TOOLKIT_ERROR_SYMBOL in x;
    }
    /**
     * Determines if a given error is an instance of AuthenticationError.
     */
    static isAuthenticationError(x) {
        return this.isToolkitError(x) && AUTHENTICATION_ERROR_SYMBOL in x;
    }
    /**
     * Determines if a given error is an instance of AssemblyError.
     */
    static isAssemblyError(x) {
        return this.isToolkitError(x) && ASSEMBLY_ERROR_SYMBOL in x;
    }
    /**
     * Determines if a given error is an instance of AssemblyError.
     */
    static isContextProviderError(x) {
        return this.isToolkitError(x) && CONTEXT_PROVIDER_ERROR_SYMBOL in x;
    }
    /**
     * An AssemblyError with an original error as cause
     */
    static withCause(message, error) {
        return new ToolkitError(message, 'toolkit', error);
    }
    /**
     * The type of the error, defaults to "toolkit".
     */
    type;
    /**
     * Denotes the source of the error as the toolkit.
     */
    source;
    /**
     * The specific original cause of the error, if available
     */
    cause;
    constructor(message, type = 'toolkit', cause) {
        super(message);
        Object.setPrototypeOf(this, ToolkitError.prototype);
        Object.defineProperty(this, TOOLKIT_ERROR_SYMBOL, { value: true });
        this.name = new.target.name;
        this.type = type;
        this.source = 'toolkit';
        this.cause = cause;
    }
}
exports.ToolkitError = ToolkitError;
/**
 * Represents an authentication-specific error in the AWS CDK Toolkit.
 */
class AuthenticationError extends ToolkitError {
    /**
     * Denotes the source of the error as user.
     */
    source = 'user';
    constructor(message) {
        super(message, 'authentication');
        Object.setPrototypeOf(this, AuthenticationError.prototype);
        Object.defineProperty(this, AUTHENTICATION_ERROR_SYMBOL, { value: true });
    }
}
exports.AuthenticationError = AuthenticationError;
/**
 * Represents an error causes by cloud assembly synthesis
 *
 * This includes errors thrown during app execution, as well as failing annotations.
 */
class AssemblyError extends ToolkitError {
    /**
     * An AssemblyError with an original error as cause
     */
    static withCause(message, error) {
        return new AssemblyError(message, undefined, error);
    }
    /**
     * An AssemblyError with a list of stacks as cause
     */
    static withStacks(message, stacks) {
        return new AssemblyError(message, stacks);
    }
    /**
     * Denotes the source of the error as user.
     */
    source = 'user';
    /**
     * The stacks that caused the error, if available
     *
     * The `messages` property of each `cxapi.CloudFormationStackArtifact` will contain the respective errors.
     * Absence indicates synthesis didn't fully complete.
     */
    stacks;
    constructor(message, stacks, cause) {
        super(message, 'assembly', cause);
        Object.setPrototypeOf(this, AssemblyError.prototype);
        Object.defineProperty(this, ASSEMBLY_ERROR_SYMBOL, { value: true });
        this.stacks = stacks;
    }
}
exports.AssemblyError = AssemblyError;
/**
 * Represents an error originating from a Context Provider
 */
class ContextProviderError extends ToolkitError {
    /**
     * Denotes the source of the error as user.
     */
    source = 'user';
    constructor(message) {
        super(message, 'context-provider');
        Object.setPrototypeOf(this, ContextProviderError.prototype);
        Object.defineProperty(this, CONTEXT_PROVIDER_ERROR_SYMBOL, { value: true });
    }
}
exports.ContextProviderError = ContextProviderError;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9vbGtpdC1lcnJvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9hcGkvdG9vbGtpdC1lcnJvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSxNQUFNLG9CQUFvQixHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsbUNBQW1DLENBQUMsQ0FBQztBQUM3RSxNQUFNLDJCQUEyQixHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsMENBQTBDLENBQUMsQ0FBQztBQUMzRixNQUFNLHFCQUFxQixHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsb0NBQW9DLENBQUMsQ0FBQztBQUMvRSxNQUFNLDZCQUE2QixHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsMkNBQTJDLENBQUMsQ0FBQztBQUU5Rjs7R0FFRztBQUNILE1BQWEsWUFBYSxTQUFRLEtBQUs7SUFDckM7O09BRUc7SUFDSSxNQUFNLENBQUMsY0FBYyxDQUFDLENBQU07UUFDakMsT0FBTyxDQUFDLEtBQUssSUFBSSxJQUFJLE9BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxRQUFRLElBQUksb0JBQW9CLElBQUksQ0FBQyxDQUFDO0lBQzNFLENBQUM7SUFFRDs7T0FFRztJQUNJLE1BQU0sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFNO1FBQ3hDLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsSUFBSSwyQkFBMkIsSUFBSSxDQUFDLENBQUM7SUFDcEUsQ0FBQztJQUVEOztPQUVHO0lBQ0ksTUFBTSxDQUFDLGVBQWUsQ0FBQyxDQUFNO1FBQ2xDLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsSUFBSSxxQkFBcUIsSUFBSSxDQUFDLENBQUM7SUFDOUQsQ0FBQztJQUVEOztPQUVHO0lBQ0ksTUFBTSxDQUFDLHNCQUFzQixDQUFDLENBQU07UUFDekMsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxJQUFJLDZCQUE2QixJQUFJLENBQUMsQ0FBQztJQUN0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NkJBQTZCLEVBQUUsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUM5RSxDQUFDO0NBQ0Y7QUFYRCxvREFXQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlICogYXMgY3hhcGkgZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcblxuY29uc3QgVE9PTEtJVF9FUlJPUl9TWU1CT0wgPSBTeW1ib2wuZm9yKCdAYXdzLWNkay90b29sa2l0LWxpYi5Ub29sa2l0RXJyb3InKTtcbmNvbnN0IEFVVEhFTlRJQ0FUSU9OX0VSUk9SX1NZTUJPTCA9IFN5bWJvbC5mb3IoJ0Bhd3MtY2RrL3Rvb2xraXQtbGliLkF1dGhlbnRpY2F0aW9uRXJyb3InKTtcbmNvbnN0IEFTU0VNQkxZX0VSUk9SX1NZTUJPTCA9IFN5bWJvbC5mb3IoJ0Bhd3MtY2RrL3Rvb2xraXQtbGliLkFzc2VtYmx5RXJyb3InKTtcbmNvbnN0IENPTlRFWFRfUFJPVklERVJfRVJST1JfU1lNQk9MID0gU3ltYm9sLmZvcignQGF3cy1jZGsvdG9vbGtpdC1saWIuQ29udGV4dFByb3ZpZGVyRXJyb3InKTtcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgZ2VuZXJhbCB0b29sa2l0IGVycm9yIGluIHRoZSBBV1MgQ0RLIFRvb2xraXQuXG4gKi9cbmV4cG9ydCBjbGFzcyBUb29sa2l0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGlmIGEgZ2l2ZW4gZXJyb3IgaXMgYW4gaW5zdGFuY2Ugb2YgVG9vbGtpdEVycm9yLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpc1Rvb2xraXRFcnJvcih4OiBhbnkpOiB4IGlzIFRvb2xraXRFcnJvciB7XG4gICAgcmV0dXJuIHggIT09IG51bGwgJiYgdHlwZW9mKHgpID09PSAnb2JqZWN0JyAmJiBUT09MS0lUX0VSUk9SX1NZTUJPTCBpbiB4O1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZXMgaWYgYSBnaXZlbiBlcnJvciBpcyBhbiBpbnN0YW5jZSBvZiBBdXRoZW50aWNhdGlvbkVycm9yLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpc0F1dGhlbnRpY2F0aW9uRXJyb3IoeDogYW55KTogeCBpcyBBdXRoZW50aWNhdGlvbkVycm9yIHtcbiAgICByZXR1cm4gdGhpcy5pc1Rvb2xraXRFcnJvcih4KSAmJiBBVVRIRU5USUNBVElPTl9FUlJPUl9TWU1CT0wgaW4geDtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGlmIGEgZ2l2ZW4gZXJyb3IgaXMgYW4gaW5zdGFuY2Ugb2YgQXNzZW1ibHlFcnJvci5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgaXNBc3NlbWJseUVycm9yKHg6IGFueSk6IHggaXMgQXNzZW1ibHlFcnJvciB7XG4gICAgcmV0dXJuIHRoaXMuaXNUb29sa2l0RXJyb3IoeCkgJiYgQVNTRU1CTFlfRVJST1JfU1lNQk9MIGluIHg7XG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5lcyBpZiBhIGdpdmVuIGVycm9yIGlzIGFuIGluc3RhbmNlIG9mIEFzc2VtYmx5RXJyb3IuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGlzQ29udGV4dFByb3ZpZGVyRXJyb3IoeDogYW55KTogeCBpcyBDb250ZXh0UHJvdmlkZXJFcnJvciB7XG4gICAgcmV0dXJuIHRoaXMuaXNUb29sa2l0RXJyb3IoeCkgJiYgQ09OVEVYVF9QUk9WSURFUl9FUlJPUl9TWU1CT0wgaW4geDtcbiAgfVxuXG4gIC8qKlxuICAgKiBBbiBBc3NlbWJseUVycm9yIHdpdGggYW4gb3JpZ2luYWwgZXJyb3IgYXMgY2F1c2VcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgd2l0aENhdXNlKG1lc3NhZ2U6IHN0cmluZywgZXJyb3I6IHVua25vd24pOiBUb29sa2l0RXJyb3Ige1xuICAgIHJldHVybiBuZXcgVG9vbGtpdEVycm9yKG1lc3NhZ2UsICd0b29sa2l0JywgZXJyb3IpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSB0eXBlIG9mIHRoZSBlcnJvciwgZGVmYXVsdHMgdG8gXCJ0b29sa2l0XCIuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgdHlwZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBEZW5vdGVzIHRoZSBzb3VyY2Ugb2YgdGhlIGVycm9yIGFzIHRoZSB0b29sa2l0LlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHNvdXJjZTogJ3Rvb2xraXQnIHwgJ3VzZXInO1xuXG4gIC8qKlxuICAgKiBUaGUgc3BlY2lmaWMgb3JpZ2luYWwgY2F1c2Ugb2YgdGhlIGVycm9yLCBpZiBhdmFpbGFibGVcbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBjYXVzZT86IHVua25vd247XG5cbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCB0eXBlOiBzdHJpbmcgPSAndG9vbGtpdCcsIGNhdXNlPzogdW5rbm93bikge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0aGlzLCBUb29sa2l0RXJyb3IucHJvdG90eXBlKTtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgVE9PTEtJVF9FUlJPUl9TWU1CT0wsIHsgdmFsdWU6IHRydWUgfSk7XG4gICAgdGhpcy5uYW1lID0gbmV3LnRhcmdldC5uYW1lO1xuICAgIHRoaXMudHlwZSA9IHR5cGU7XG4gICAgdGhpcy5zb3VyY2UgPSAndG9vbGtpdCc7XG4gICAgdGhpcy5jYXVzZSA9IGNhdXNlO1xuICB9XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyBhbiBhdXRoZW50aWNhdGlvbi1zcGVjaWZpYyBlcnJvciBpbiB0aGUgQVdTIENESyBUb29sa2l0LlxuICovXG5leHBvcnQgY2xhc3MgQXV0aGVudGljYXRpb25FcnJvciBleHRlbmRzIFRvb2xraXRFcnJvciB7XG4gIC8qKlxuICAgKiBEZW5vdGVzIHRoZSBzb3VyY2Ugb2YgdGhlIGVycm9yIGFzIHVzZXIuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc291cmNlID0gJ3VzZXInO1xuXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UsICdhdXRoZW50aWNhdGlvbicpO1xuICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0aGlzLCBBdXRoZW50aWNhdGlvbkVycm9yLnByb3RvdHlwZSk7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsIEFVVEhFTlRJQ0FUSU9OX0VSUk9SX1NZTUJPTCwgeyB2YWx1ZTogdHJ1ZSB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgYW4gZXJyb3IgY2F1c2VzIGJ5IGNsb3VkIGFzc2VtYmx5IHN5bnRoZXNpc1xuICpcbiAqIFRoaXMgaW5jbHVkZXMgZXJyb3JzIHRocm93biBkdXJpbmcgYXBwIGV4ZWN1dGlvbiwgYXMgd2VsbCBhcyBmYWlsaW5nIGFubm90YXRpb25zLlxuICovXG5leHBvcnQgY2xhc3MgQXNzZW1ibHlFcnJvciBleHRlbmRzIFRvb2xraXRFcnJvciB7XG4gIC8qKlxuICAgKiBBbiBBc3NlbWJseUVycm9yIHdpdGggYW4gb3JpZ2luYWwgZXJyb3IgYXMgY2F1c2VcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgd2l0aENhdXNlKG1lc3NhZ2U6IHN0cmluZywgZXJyb3I6IHVua25vd24pOiBBc3NlbWJseUVycm9yIHtcbiAgICByZXR1cm4gbmV3IEFzc2VtYmx5RXJyb3IobWVzc2FnZSwgdW5kZWZpbmVkLCBlcnJvcik7XG4gIH1cblxuICAvKipcbiAgICogQW4gQXNzZW1ibHlFcnJvciB3aXRoIGEgbGlzdCBvZiBzdGFja3MgYXMgY2F1c2VcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgd2l0aFN0YWNrcyhtZXNzYWdlOiBzdHJpbmcsIHN0YWNrcz86IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdFtdKTogQXNzZW1ibHlFcnJvciB7XG4gICAgcmV0dXJuIG5ldyBBc3NlbWJseUVycm9yKG1lc3NhZ2UsIHN0YWNrcyk7XG4gIH1cblxuICAvKipcbiAgICogRGVub3RlcyB0aGUgc291cmNlIG9mIHRoZSBlcnJvciBhcyB1c2VyLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHNvdXJjZSA9ICd1c2VyJztcblxuICAvKipcbiAgICogVGhlIHN0YWNrcyB0aGF0IGNhdXNlZCB0aGUgZXJyb3IsIGlmIGF2YWlsYWJsZVxuICAgKlxuICAgKiBUaGUgYG1lc3NhZ2VzYCBwcm9wZXJ0eSBvZiBlYWNoIGBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3RgIHdpbGwgY29udGFpbiB0aGUgcmVzcGVjdGl2ZSBlcnJvcnMuXG4gICAqIEFic2VuY2UgaW5kaWNhdGVzIHN5bnRoZXNpcyBkaWRuJ3QgZnVsbHkgY29tcGxldGUuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc3RhY2tzPzogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0W107XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIHN0YWNrcz86IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdFtdLCBjYXVzZT86IHVua25vd24pIHtcbiAgICBzdXBlcihtZXNzYWdlLCAnYXNzZW1ibHknLCBjYXVzZSk7XG4gICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRoaXMsIEFzc2VtYmx5RXJyb3IucHJvdG90eXBlKTtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgQVNTRU1CTFlfRVJST1JfU1lNQk9MLCB7IHZhbHVlOiB0cnVlIH0pO1xuICAgIHRoaXMuc3RhY2tzID0gc3RhY2tzO1xuICB9XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyBhbiBlcnJvciBvcmlnaW5hdGluZyBmcm9tIGEgQ29udGV4dCBQcm92aWRlclxuICovXG5leHBvcnQgY2xhc3MgQ29udGV4dFByb3ZpZGVyRXJyb3IgZXh0ZW5kcyBUb29sa2l0RXJyb3Ige1xuICAvKipcbiAgICogRGVub3RlcyB0aGUgc291cmNlIG9mIHRoZSBlcnJvciBhcyB1c2VyLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHNvdXJjZSA9ICd1c2VyJztcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlLCAnY29udGV4dC1wcm92aWRlcicpO1xuICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0aGlzLCBDb250ZXh0UHJvdmlkZXJFcnJvci5wcm90b3R5cGUpO1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCBDT05URVhUX1BST1ZJREVSX0VSUk9SX1NZTUJPTCwgeyB2YWx1ZTogdHJ1ZSB9KTtcbiAgfVxufVxuIl19