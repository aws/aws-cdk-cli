"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toYAML = toYAML;
exports.deserializeStructure = deserializeStructure;
exports.serializeStructure = serializeStructure;
exports.loadStructuredFile = loadStructuredFile;
exports.obscureTemplate = obscureTemplate;
exports.replacerBufferWithInfo = replacerBufferWithInfo;
const fs = require("fs/promises");
const bytes_1 = require("./bytes");
const yaml_cfn = require("./yaml-cfn");
/**
 * Stringify to YAML
 */
function toYAML(obj) {
    return yaml_cfn.serialize(obj);
}
/**
 * Parse either YAML or JSON
 */
function deserializeStructure(str) {
    return yaml_cfn.deserialize(str);
}
/**
 * Serialize to either YAML or JSON
 */
function serializeStructure(object, json) {
    if (json) {
        return JSON.stringify(object, undefined, 2);
    }
    else {
        return toYAML(object);
    }
}
/**
 * Load a YAML or JSON file from disk
 */
async function loadStructuredFile(fileName) {
    const contents = await fs.readFile(fileName, { encoding: 'utf-8' });
    return deserializeStructure(contents);
}
/**
 * Remove any template elements that we don't want to show users.
 */
function obscureTemplate(template = {}) {
    if (template.Rules) {
        // see https://github.com/aws/aws-cdk/issues/17942
        if (template.Rules.CheckBootstrapVersion) {
            if (Object.keys(template.Rules).length > 1) {
                delete template.Rules.CheckBootstrapVersion;
            }
            else {
                delete template.Rules;
            }
        }
    }
    return template;
}
/**
 * Detects a buffer that has been converted to a JSON-like object
 * In Node, `Buffer`s have `toJSON()` method that converts the buffer
 * into a JS object that can be JSON stringified.
 * Unfortunately this conversion happens before the replacer is called,
 * so normal means of detecting a `Buffer` objet don't work anymore.
 * @see https://github.com/nodejs/node-v0.x-archive/issues/5110
 */
function isJsonBuffer(value) {
    return typeof value === 'object'
        && 'type' in value
        && value.type === 'Buffer'
        && 'data' in value
        && Array.isArray(value.data);
}
/**
 * A JSON.stringify() replacer that converts Buffers into a string with information
 * Use this if you plan to print out JSON stringified objects that may contain a Buffer.
 * Without this, large buffers (think: Megabytes) will completely fill up the output
 * and even crash the system.
 */
function replacerBufferWithInfo(_key, value) {
    if (isJsonBuffer(value)) {
        return `<Buffer: ${(0, bytes_1.formatBytes)(value.data.length)}>`;
    }
    return value;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VyaWFsaXplLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWwvc2VyaWFsaXplLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBT0Esd0JBRUM7QUFLRCxvREFFQztBQUtELGdEQU1DO0FBS0QsZ0RBR0M7QUFLRCwwQ0FhQztBQTJCRCx3REFLQztBQXJGRCxrQ0FBa0M7QUFDbEMsbUNBQXNDO0FBQ3RDLHVDQUF1QztBQUV2Qzs7R0FFRztBQUNILFNBQWdCLE1BQU0sQ0FBQyxHQUFRO0lBQzdCLE9BQU8sUUFBUSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNqQyxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixvQkFBb0IsQ0FBQyxHQUFXO0lBQzlDLE9BQU8sUUFBUSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNuQyxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixrQkFBa0IsQ0FBQyxNQUFXLEVBQUUsSUFBYTtJQUMzRCxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ1QsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDOUMsQ0FBQztTQUFNLENBQUM7UUFDTixPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUN4QixDQUFDO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0ksS0FBSyxVQUFVLGtCQUFrQixDQUFDLFFBQWdCO0lBQ3ZELE1BQU0sUUFBUSxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztJQUNwRSxPQUFPLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ3hDLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGVBQWUsQ0FBQyxXQUFnQixFQUFFO0lBQ2hELElBQUksUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ25CLGtEQUFrRDtRQUNsRCxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUUsQ0FBQztZQUN6QyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDM0MsT0FBTyxRQUFRLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDO1lBQzlDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixPQUFPLFFBQVEsQ0FBQyxLQUFLLENBQUM7WUFDeEIsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxRQUFRLENBQUM7QUFDbEIsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLFlBQVksQ0FBQyxLQUFVO0lBSTlCLE9BQU8sT0FBTyxLQUFLLEtBQUssUUFBUTtXQUMzQixNQUFNLElBQUksS0FBSztXQUNmLEtBQUssQ0FBQyxJQUFJLEtBQUssUUFBUTtXQUN2QixNQUFNLElBQUksS0FBSztXQUNmLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ2pDLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQWdCLHNCQUFzQixDQUFDLElBQVMsRUFBRSxLQUFVO0lBQzFELElBQUksWUFBWSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDeEIsT0FBTyxZQUFZLElBQUEsbUJBQVcsRUFBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUM7SUFDdkQsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCB7IGZvcm1hdEJ5dGVzIH0gZnJvbSAnLi9ieXRlcyc7XG5pbXBvcnQgKiBhcyB5YW1sX2NmbiBmcm9tICcuL3lhbWwtY2ZuJztcblxuLyoqXG4gKiBTdHJpbmdpZnkgdG8gWUFNTFxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9ZQU1MKG9iajogYW55KTogc3RyaW5nIHtcbiAgcmV0dXJuIHlhbWxfY2ZuLnNlcmlhbGl6ZShvYmopO1xufVxuXG4vKipcbiAqIFBhcnNlIGVpdGhlciBZQU1MIG9yIEpTT05cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplU3RydWN0dXJlKHN0cjogc3RyaW5nKTogYW55IHtcbiAgcmV0dXJuIHlhbWxfY2ZuLmRlc2VyaWFsaXplKHN0cik7XG59XG5cbi8qKlxuICogU2VyaWFsaXplIHRvIGVpdGhlciBZQU1MIG9yIEpTT05cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZVN0cnVjdHVyZShvYmplY3Q6IGFueSwganNvbjogYm9vbGVhbikge1xuICBpZiAoanNvbikge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShvYmplY3QsIHVuZGVmaW5lZCwgMik7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHRvWUFNTChvYmplY3QpO1xuICB9XG59XG5cbi8qKlxuICogTG9hZCBhIFlBTUwgb3IgSlNPTiBmaWxlIGZyb20gZGlza1xuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFN0cnVjdHVyZWRGaWxlKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgY29uc3QgY29udGVudHMgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlTmFtZSwgeyBlbmNvZGluZzogJ3V0Zi04JyB9KTtcbiAgcmV0dXJuIGRlc2VyaWFsaXplU3RydWN0dXJlKGNvbnRlbnRzKTtcbn1cblxuLyoqXG4gKiBSZW1vdmUgYW55IHRlbXBsYXRlIGVsZW1lbnRzIHRoYXQgd2UgZG9uJ3Qgd2FudCB0byBzaG93IHVzZXJzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gb2JzY3VyZVRlbXBsYXRlKHRlbXBsYXRlOiBhbnkgPSB7fSkge1xuICBpZiAodGVtcGxhdGUuUnVsZXMpIHtcbiAgICAvLyBzZWUgaHR0cHM6Ly9naXRodWIuY29tL2F3cy9hd3MtY2RrL2lzc3Vlcy8xNzk0MlxuICAgIGlmICh0ZW1wbGF0ZS5SdWxlcy5DaGVja0Jvb3RzdHJhcFZlcnNpb24pIHtcbiAgICAgIGlmIChPYmplY3Qua2V5cyh0ZW1wbGF0ZS5SdWxlcykubGVuZ3RoID4gMSkge1xuICAgICAgICBkZWxldGUgdGVtcGxhdGUuUnVsZXMuQ2hlY2tCb290c3RyYXBWZXJzaW9uO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVsZXRlIHRlbXBsYXRlLlJ1bGVzO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0ZW1wbGF0ZTtcbn1cblxuLyoqXG4gKiBEZXRlY3RzIGEgYnVmZmVyIHRoYXQgaGFzIGJlZW4gY29udmVydGVkIHRvIGEgSlNPTi1saWtlIG9iamVjdFxuICogSW4gTm9kZSwgYEJ1ZmZlcmBzIGhhdmUgYHRvSlNPTigpYCBtZXRob2QgdGhhdCBjb252ZXJ0cyB0aGUgYnVmZmVyXG4gKiBpbnRvIGEgSlMgb2JqZWN0IHRoYXQgY2FuIGJlIEpTT04gc3RyaW5naWZpZWQuXG4gKiBVbmZvcnR1bmF0ZWx5IHRoaXMgY29udmVyc2lvbiBoYXBwZW5zIGJlZm9yZSB0aGUgcmVwbGFjZXIgaXMgY2FsbGVkLFxuICogc28gbm9ybWFsIG1lYW5zIG9mIGRldGVjdGluZyBhIGBCdWZmZXJgIG9iamV0IGRvbid0IHdvcmsgYW55bW9yZS5cbiAqIEBzZWUgaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlLXYwLngtYXJjaGl2ZS9pc3N1ZXMvNTExMFxuICovXG5mdW5jdGlvbiBpc0pzb25CdWZmZXIodmFsdWU6IGFueSk6IHZhbHVlIGlzIHtcbiAgdHlwZTogJ0J1ZmZlcic7XG4gIGRhdGE6IG51bWJlcltdO1xufSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnXG4gICAgJiYgJ3R5cGUnIGluIHZhbHVlXG4gICAgJiYgdmFsdWUudHlwZSA9PT0gJ0J1ZmZlcidcbiAgICAmJiAnZGF0YScgaW4gdmFsdWVcbiAgICAmJiBBcnJheS5pc0FycmF5KHZhbHVlLmRhdGEpO1xufVxuXG4vKipcbiAqIEEgSlNPTi5zdHJpbmdpZnkoKSByZXBsYWNlciB0aGF0IGNvbnZlcnRzIEJ1ZmZlcnMgaW50byBhIHN0cmluZyB3aXRoIGluZm9ybWF0aW9uXG4gKiBVc2UgdGhpcyBpZiB5b3UgcGxhbiB0byBwcmludCBvdXQgSlNPTiBzdHJpbmdpZmllZCBvYmplY3RzIHRoYXQgbWF5IGNvbnRhaW4gYSBCdWZmZXIuXG4gKiBXaXRob3V0IHRoaXMsIGxhcmdlIGJ1ZmZlcnMgKHRoaW5rOiBNZWdhYnl0ZXMpIHdpbGwgY29tcGxldGVseSBmaWxsIHVwIHRoZSBvdXRwdXRcbiAqIGFuZCBldmVuIGNyYXNoIHRoZSBzeXN0ZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXBsYWNlckJ1ZmZlcldpdGhJbmZvKF9rZXk6IGFueSwgdmFsdWU6IGFueSk6IGFueSB7XG4gIGlmIChpc0pzb25CdWZmZXIodmFsdWUpKSB7XG4gICAgcmV0dXJuIGA8QnVmZmVyOiAke2Zvcm1hdEJ5dGVzKHZhbHVlLmRhdGEubGVuZ3RoKX0+YDtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG4iXX0=