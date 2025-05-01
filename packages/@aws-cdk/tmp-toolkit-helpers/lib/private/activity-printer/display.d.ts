/**
 * A class representing rewritable display lines
 */
export declare class RewritableBlock {
    private readonly stream;
    private lastHeight;
    private trailingEmptyLines;
    constructor(stream: NodeJS.WriteStream);
    get width(): number;
    get height(): number;
    displayLines(lines: string[]): void;
    removeEmptyLines(): void;
}
