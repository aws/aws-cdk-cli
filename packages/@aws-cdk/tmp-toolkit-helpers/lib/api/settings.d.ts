export type SettingsMap = {
    [key: string]: any;
};
/**
 * If a context value is an object with this key set to a truthy value, it won't be saved to cdk.context.json
 */
export declare const TRANSIENT_CONTEXT_KEY = "$dontSaveContext";
/**
 * A single bag of settings
 */
export declare class Settings {
    private settings;
    readonly readOnly: boolean;
    static mergeAll(...settings: Settings[]): Settings;
    constructor(settings?: SettingsMap, readOnly?: boolean);
    save(fileName: string): Promise<this>;
    get all(): any;
    merge(other: Settings): Settings;
    subSettings(keyPrefix: string[]): Settings;
    makeReadOnly(): Settings;
    clear(): void;
    get empty(): boolean;
    get(path: string[]): any;
    set(path: string[], value: any): Settings;
    unset(path: string[]): void;
}
