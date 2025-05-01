export interface ContextProviderPlugin {
    getValue(args: {
        [key: string]: any;
    }): Promise<any>;
}
export declare function isContextProviderPlugin(x: unknown): x is ContextProviderPlugin;
