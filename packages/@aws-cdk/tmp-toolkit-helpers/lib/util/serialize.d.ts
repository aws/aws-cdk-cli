/**
 * Stringify to YAML
 */
export declare function toYAML(obj: any): string;
/**
 * Parse either YAML or JSON
 */
export declare function deserializeStructure(str: string): any;
/**
 * Serialize to either YAML or JSON
 */
export declare function serializeStructure(object: any, json: boolean): string;
/**
 * Load a YAML or JSON file from disk
 */
export declare function loadStructuredFile(fileName: string): Promise<any>;
/**
 * Remove any template elements that we don't want to show users.
 */
export declare function obscureTemplate(template?: any): any;
/**
 * A JSON.stringify() replacer that converts Buffers into a string with information
 * Use this if you plan to print out JSON stringified objects that may contain a Buffer.
 * Without this, large buffers (think: Megabytes) will completely fill up the output
 * and even crash the system.
 */
export declare function replacerBufferWithInfo(_key: any, value: any): any;
