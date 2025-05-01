import { Settings } from './settings';
export { TRANSIENT_CONTEXT_KEY } from './settings';
export declare const PROJECT_CONTEXT = "cdk.context.json";
interface ContextBag {
    /**
     * The file name of the context. Will be used to potentially
     * save new context back to the original file.
     */
    fileName?: string;
    /**
     * The context values.
     */
    bag: Settings;
}
/**
 * Class that supports overlaying property bags
 *
 * Reads come from the first property bag that can has the given key,
 * writes go to the first property bag that is not readonly. A write
 * will remove the value from all property bags after the first
 * writable one.
 */
export declare class Context {
    private readonly bags;
    private readonly fileNames;
    constructor(...bags: ContextBag[]);
    get keys(): string[];
    has(key: string): boolean;
    get all(): {
        [key: string]: any;
    };
    get(key: string): any;
    set(key: string, value: any): void;
    unset(key: string): void;
    clear(): void;
    /**
     * Save a specific context file
     */
    save(fileName: string): Promise<this>;
}
