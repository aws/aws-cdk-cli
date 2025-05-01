import { Writable } from 'node:stream';
export declare class StringWriteStream extends Writable {
    private buffer;
    constructor();
    _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void): void;
    toString(): string;
}
