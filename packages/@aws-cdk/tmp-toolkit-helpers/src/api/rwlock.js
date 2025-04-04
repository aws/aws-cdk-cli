"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RWLock = void 0;
const fs_1 = require("fs");
const path = require("path");
const api_1 = require("../../../@aws-cdk/tmp-toolkit-helpers/src/api");
/**
 * A single-writer/multi-reader lock on a directory
 *
 * It uses marker files with PIDs in them as a locking marker; the PIDs will be
 * checked for liveness, so that if the process exits without cleaning up the
 * files the lock is implicitly released.
 *
 * This class is not 100% race safe, but in practice it should be a lot
 * better than the 0 protection we have today.
 */
/* c8 ignore start */ // code paths are unpredictable
class RWLock {
    constructor(directory) {
        this.directory = directory;
        this.readCounter = 0;
        this.pidString = `${process.pid}`;
        this.writerFile = path.join(this.directory, 'synth.lock');
    }
    /**
     * Acquire a writer lock.
     *
     * No other readers or writers must exist for the given directory.
     */
    async acquireWrite() {
        await this.assertNoOtherWriters();
        const readers = await this.currentReaders();
        if (readers.length > 0) {
            throw new api_1.ToolkitError(`Other CLIs (PID=${readers}) are currently reading from ${this.directory}. Invoke the CLI in sequence, or use '--output' to synth into different directories.`);
        }
        await writeFileAtomic(this.writerFile, this.pidString);
        return {
            release: async () => {
                await deleteFile(this.writerFile);
            },
            convertToReaderLock: async () => {
                // Acquire the read lock before releasing the write lock. Slightly less
                // chance of racing!
                const ret = await this.doAcquireRead();
                await deleteFile(this.writerFile);
                return ret;
            },
        };
    }
    /**
     * Acquire a read lock
     *
     * Will fail if there are any writers.
     */
    async acquireRead() {
        await this.assertNoOtherWriters();
        return this.doAcquireRead();
    }
    /**
     * Obtains the name fo a (new) `readerFile` to use. This includes a counter so
     * that if multiple threads of the same PID attempt to concurrently acquire
     * the same lock, they're guaranteed to use a different reader file name (only
     * one thread will ever execute JS code at once, guaranteeing the readCounter
     * is incremented "atomically" from the point of view of this PID.).
     */
    readerFile() {
        return path.join(this.directory, `read.${this.pidString}.${++this.readCounter}.lock`);
    }
    /**
     * Do the actual acquiring of a read lock.
     */
    async doAcquireRead() {
        const readerFile = this.readerFile();
        await writeFileAtomic(readerFile, this.pidString);
        return {
            release: async () => {
                await deleteFile(readerFile);
            },
        };
    }
    async assertNoOtherWriters() {
        const writer = await this.currentWriter();
        if (writer) {
            throw new api_1.ToolkitError(`Another CLI (PID=${writer}) is currently synthing to ${this.directory}. Invoke the CLI in sequence, or use '--output' to synth into different directories.`);
        }
    }
    /**
     * Check the current writer (if any)
     */
    async currentWriter() {
        const contents = await readFileIfExists(this.writerFile);
        if (!contents) {
            return undefined;
        }
        const pid = parseInt(contents, 10);
        if (!processExists(pid)) {
            // Do cleanup of a stray file now
            await deleteFile(this.writerFile);
            return undefined;
        }
        return pid;
    }
    /**
     * Check the current readers (if any)
     */
    async currentReaders() {
        const re = /^read\.([^.]+)\.[^.]+\.lock$/;
        const ret = new Array();
        let children;
        try {
            children = await fs_1.promises.readdir(this.directory, { encoding: 'utf-8' });
        }
        catch (e) {
            // Can't be locked if the directory doesn't exist
            if (e.code === 'ENOENT') {
                return [];
            }
            throw e;
        }
        for (const fname of children) {
            const m = fname.match(re);
            if (m) {
                const pid = parseInt(m[1], 10);
                if (processExists(pid)) {
                    ret.push(pid);
                }
                else {
                    // Do cleanup of a stray file now
                    await deleteFile(path.join(this.directory, fname));
                }
            }
        }
        return ret;
    }
}
exports.RWLock = RWLock;
/* c8 ignore start */ // code paths are unpredictable
async function readFileIfExists(filename) {
    try {
        return await fs_1.promises.readFile(filename, { encoding: 'utf-8' });
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            return undefined;
        }
        throw e;
    }
}
/* c8 ignore stop */
let tmpCounter = 0;
/* c8 ignore start */ // code paths are unpredictable
async function writeFileAtomic(filename, contents) {
    await fs_1.promises.mkdir(path.dirname(filename), { recursive: true });
    const tmpFile = `${filename}.${process.pid}_${++tmpCounter}`;
    await fs_1.promises.writeFile(tmpFile, contents, { encoding: 'utf-8' });
    await fs_1.promises.rename(tmpFile, filename);
}
/* c8 ignore stop */
/* c8 ignore start */ // code paths are unpredictable
async function deleteFile(filename) {
    try {
        await fs_1.promises.unlink(filename);
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            return;
        }
        throw e;
    }
}
/* c8 ignore stop */
/* c8 ignore start */ // code paths are unpredictable
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return false;
    }
}
/* c8 ignore stop */
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicndsb2NrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicndsb2NrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJCQUFvQztBQUNwQyw2QkFBNkI7QUFDN0IsdUVBQTZFO0FBRTdFOzs7Ozs7Ozs7R0FTRztBQUNILHFCQUFxQixDQUFDLCtCQUErQjtBQUNyRCxNQUFhLE1BQU07SUFLakIsWUFBNEIsU0FBaUI7UUFBakIsY0FBUyxHQUFULFNBQVMsQ0FBUTtRQUZyQyxnQkFBVyxHQUFHLENBQUMsQ0FBQztRQUd0QixJQUFJLENBQUMsU0FBUyxHQUFHLEdBQUcsT0FBTyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBRWxDLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxDQUFDO0lBQzVELENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksS0FBSyxDQUFDLFlBQVk7UUFDdkIsTUFBTSxJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztRQUVsQyxNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztRQUM1QyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDdkIsTUFBTSxJQUFJLGtCQUFZLENBQUMsbUJBQW1CLE9BQU8sZ0NBQWdDLElBQUksQ0FBQyxTQUFTLHNGQUFzRixDQUFDLENBQUM7UUFDekwsQ0FBQztRQUVELE1BQU0sZUFBZSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRXZELE9BQU87WUFDTCxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ2xCLE1BQU0sVUFBVSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUNwQyxDQUFDO1lBQ0QsbUJBQW1CLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQzlCLHVFQUF1RTtnQkFDdkUsb0JBQW9CO2dCQUNw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QUFNLGFBQUUsQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLFFBQVEsRUFBRSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDO0lBQzdELE1BQU0sYUFBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7QUFDckMsQ0FBQztBQUNELG9CQUFvQjtBQUVwQixxQkFBcUIsQ0FBQywrQkFBK0I7QUFDckQsS0FBSyxVQUFVLFVBQVUsQ0FBQyxRQUFnQjtJQUN4QyxJQUFJLENBQUM7UUFDSCxNQUFNLGFBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDNUIsQ0FBQztJQUFDLE9BQU8sQ0FBTSxFQUFFLENBQUM7UUFDaEIsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3hCLE9BQU87UUFDVCxDQUFDO1FBQ0QsTUFBTSxDQUFDLENBQUM7SUFDVixDQUFDO0FBQ0gsQ0FBQztBQUNELG9CQUFvQjtBQUVwQixxQkFBcUIsQ0FBQywrQkFBK0I7QUFDckQsU0FBUyxhQUFhLENBQUMsR0FBVztJQUNoQyxJQUFJLENBQUM7UUFDSCxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUNyQixPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ1gsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0FBQ0gsQ0FBQztBQUNELG9CQUFvQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHByb21pc2VzIGFzIGZzIH0gZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4uLy4uLy4uL0Bhd3MtY2RrL3RtcC10b29sa2l0LWhlbHBlcnMvc3JjL2FwaSc7XG5cbi8qKlxuICogQSBzaW5nbGUtd3JpdGVyL211bHRpLXJlYWRlciBsb2NrIG9uIGEgZGlyZWN0b3J5XG4gKlxuICogSXQgdXNlcyBtYXJrZXIgZmlsZXMgd2l0aCBQSURzIGluIHRoZW0gYXMgYSBsb2NraW5nIG1hcmtlcjsgdGhlIFBJRHMgd2lsbCBiZVxuICogY2hlY2tlZCBmb3IgbGl2ZW5lc3MsIHNvIHRoYXQgaWYgdGhlIHByb2Nlc3MgZXhpdHMgd2l0aG91dCBjbGVhbmluZyB1cCB0aGVcbiAqIGZpbGVzIHRoZSBsb2NrIGlzIGltcGxpY2l0bHkgcmVsZWFzZWQuXG4gKlxuICogVGhpcyBjbGFzcyBpcyBub3QgMTAwJSByYWNlIHNhZmUsIGJ1dCBpbiBwcmFjdGljZSBpdCBzaG91bGQgYmUgYSBsb3RcbiAqIGJldHRlciB0aGFuIHRoZSAwIHByb3RlY3Rpb24gd2UgaGF2ZSB0b2RheS5cbiAqL1xuLyogYzggaWdub3JlIHN0YXJ0ICovIC8vIGNvZGUgcGF0aHMgYXJlIHVucHJlZGljdGFibGVcbmV4cG9ydCBjbGFzcyBSV0xvY2sge1xuICBwcml2YXRlIHJlYWRvbmx5IHBpZFN0cmluZzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHdyaXRlckZpbGU6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkQ291bnRlciA9IDA7XG5cbiAgY29uc3RydWN0b3IocHVibGljIHJlYWRvbmx5IGRpcmVjdG9yeTogc3RyaW5nKSB7XG4gICAgdGhpcy5waWRTdHJpbmcgPSBgJHtwcm9jZXNzLnBpZH1gO1xuXG4gICAgdGhpcy53cml0ZXJGaWxlID0gcGF0aC5qb2luKHRoaXMuZGlyZWN0b3J5LCAnc3ludGgubG9jaycpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmUgYSB3cml0ZXIgbG9jay5cbiAgICpcbiAgICogTm8gb3RoZXIgcmVhZGVycyBvciB3cml0ZXJzIG11c3QgZXhpc3QgZm9yIHRoZSBnaXZlbiBkaXJlY3RvcnkuXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgYWNxdWlyZVdyaXRlKCk6IFByb21pc2U8SVdyaXRlckxvY2s+IHtcbiAgICBhd2FpdCB0aGlzLmFzc2VydE5vT3RoZXJXcml0ZXJzKCk7XG5cbiAgICBjb25zdCByZWFkZXJzID0gYXdhaXQgdGhpcy5jdXJyZW50UmVhZGVycygpO1xuICAgIGlmIChyZWFkZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYE90aGVyIENMSXMgKFBJRD0ke3JlYWRlcnN9KSBhcmUgY3VycmVudGx5IHJlYWRpbmcgZnJvbSAke3RoaXMuZGlyZWN0b3J5fS4gSW52b2tlIHRoZSBDTEkgaW4gc2VxdWVuY2UsIG9yIHVzZSAnLS1vdXRwdXQnIHRvIHN5bnRoIGludG8gZGlmZmVyZW50IGRpcmVjdG9yaWVzLmApO1xuICAgIH1cblxuICAgIGF3YWl0IHdyaXRlRmlsZUF0b21pYyh0aGlzLndyaXRlckZpbGUsIHRoaXMucGlkU3RyaW5nKTtcblxuICAgIHJldHVybiB7XG4gICAgICByZWxlYXNlOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRlbGV0ZUZpbGUodGhpcy53cml0ZXJGaWxlKTtcbiAgICAgIH0sXG4gICAgICBjb252ZXJ0VG9SZWFkZXJMb2NrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIEFjcXVpcmUgdGhlIHJlYWQgbG9jayBiZWZvcmUgcmVsZWFzaW5nIHRoZSB3cml0ZSBsb2NrLiBTbGlnaHRseSBsZXNzXG4gICAgICAgIC8vIGNoYW5jZSBvZiByYWNpbmchXG4gICAgICAgIGNvbnN0IHJldCA9IGF3YWl0IHRoaXMuZG9BY3F1aXJlUmVhZCgpO1xuICAgICAgICBhd2FpdCBkZWxldGVGaWxlKHRoaXMud3JpdGVyRmlsZSk7XG4gICAgICAgIHJldHVybiByZXQ7XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQWNxdWlyZSBhIHJlYWQgbG9ja1xuICAgKlxuICAgKiBXaWxsIGZhaWwgaWYgdGhlcmUgYXJlIGFueSB3cml0ZXJzLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIGFjcXVpcmVSZWFkKCk6IFByb21pc2U8SUxvY2s+IHtcbiAgICBhd2FpdCB0aGlzLmFzc2VydE5vT3RoZXJXcml0ZXJzKCk7XG4gICAgcmV0dXJuIHRoaXMuZG9BY3F1aXJlUmVhZCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIE9idGFpbnMgdGhlIG5hbWUgZm8gYSAobmV3KSBgcmVhZGVyRmlsZWAgdG8gdXNlLiBUaGlzIGluY2x1ZGVzIGEgY291bnRlciBzb1xuICAgKiB0aGF0IGlmIG11bHRpcGxlIHRocmVhZHMgb2YgdGhlIHNhbWUgUElEIGF0dGVtcHQgdG8gY29uY3VycmVudGx5IGFjcXVpcmVcbiAgICogdGhlIHNhbWUgbG9jaywgdGhleSdyZSBndWFyYW50ZWVkIHRvIHVzZSBhIGRpZmZlcmVudCByZWFkZXIgZmlsZSBuYW1lIChvbmx5XG4gICAqIG9uZSB0aHJlYWQgd2lsbCBldmVyIGV4ZWN1dGUgSlMgY29kZSBhdCBvbmNlLCBndWFyYW50ZWVpbmcgdGhlIHJlYWRDb3VudGVyXG4gICAqIGlzIGluY3JlbWVudGVkIFwiYXRvbWljYWxseVwiIGZyb20gdGhlIHBvaW50IG9mIHZpZXcgb2YgdGhpcyBQSUQuKS5cbiAgICovXG4gIHByaXZhdGUgcmVhZGVyRmlsZSgpOiBzdHJpbmcge1xuICAgIHJldHVybiBwYXRoLmpvaW4odGhpcy5kaXJlY3RvcnksIGByZWFkLiR7dGhpcy5waWRTdHJpbmd9LiR7Kyt0aGlzLnJlYWRDb3VudGVyfS5sb2NrYCk7XG4gIH1cblxuICAvKipcbiAgICogRG8gdGhlIGFjdHVhbCBhY3F1aXJpbmcgb2YgYSByZWFkIGxvY2suXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGRvQWNxdWlyZVJlYWQoKTogUHJvbWlzZTxJTG9jaz4ge1xuICAgIGNvbnN0IHJlYWRlckZpbGUgPSB0aGlzLnJlYWRlckZpbGUoKTtcbiAgICBhd2FpdCB3cml0ZUZpbGVBdG9taWMocmVhZGVyRmlsZSwgdGhpcy5waWRTdHJpbmcpO1xuICAgIHJldHVybiB7XG4gICAgICByZWxlYXNlOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGRlbGV0ZUZpbGUocmVhZGVyRmlsZSk7XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFzc2VydE5vT3RoZXJXcml0ZXJzKCkge1xuICAgIGNvbnN0IHdyaXRlciA9IGF3YWl0IHRoaXMuY3VycmVudFdyaXRlcigpO1xuICAgIGlmICh3cml0ZXIpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYEFub3RoZXIgQ0xJIChQSUQ9JHt3cml0ZXJ9KSBpcyBjdXJyZW50bHkgc3ludGhpbmcgdG8gJHt0aGlzLmRpcmVjdG9yeX0uIEludm9rZSB0aGUgQ0xJIGluIHNlcXVlbmNlLCBvciB1c2UgJy0tb3V0cHV0JyB0byBzeW50aCBpbnRvIGRpZmZlcmVudCBkaXJlY3Rvcmllcy5gKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgdGhlIGN1cnJlbnQgd3JpdGVyIChpZiBhbnkpXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGN1cnJlbnRXcml0ZXIoKTogUHJvbWlzZTxudW1iZXIgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBjb250ZW50cyA9IGF3YWl0IHJlYWRGaWxlSWZFeGlzdHModGhpcy53cml0ZXJGaWxlKTtcbiAgICBpZiAoIWNvbnRlbnRzKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IHBpZCA9IHBhcnNlSW50KGNvbnRlbnRzLCAxMCk7XG4gICAgaWYgKCFwcm9jZXNzRXhpc3RzKHBpZCkpIHtcbiAgICAgIC8vIERvIGNsZWFudXAgb2YgYSBzdHJheSBmaWxlIG5vd1xuICAgICAgYXdhaXQgZGVsZXRlRmlsZSh0aGlzLndyaXRlckZpbGUpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gcGlkO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIHRoZSBjdXJyZW50IHJlYWRlcnMgKGlmIGFueSlcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgY3VycmVudFJlYWRlcnMoKTogUHJvbWlzZTxudW1iZXJbXT4ge1xuICAgIGNvbnN0IHJlID0gL15yZWFkXFwuKFteLl0rKVxcLlteLl0rXFwubG9jayQvO1xuICAgIGNvbnN0IHJldCA9IG5ldyBBcnJheTxudW1iZXI+KCk7XG5cbiAgICBsZXQgY2hpbGRyZW47XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkcmVuID0gYXdhaXQgZnMucmVhZGRpcih0aGlzLmRpcmVjdG9yeSwgeyBlbmNvZGluZzogJ3V0Zi04JyB9KTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIC8vIENhbid0IGJlIGxvY2tlZCBpZiB0aGUgZGlyZWN0b3J5IGRvZXNuJ3QgZXhpc3RcbiAgICAgIGlmIChlLmNvZGUgPT09ICdFTk9FTlQnKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmbmFtZSBvZiBjaGlsZHJlbikge1xuICAgICAgY29uc3QgbSA9IGZuYW1lLm1hdGNoKHJlKTtcbiAgICAgIGlmIChtKSB7XG4gICAgICAgIGNvbnN0IHBpZCA9IHBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICAgICAgaWYgKHByb2Nlc3NFeGlzdHMocGlkKSkge1xuICAgICAgICAgIHJldC5wdXNoKHBpZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRG8gY2xlYW51cCBvZiBhIHN0cmF5IGZpbGUgbm93XG4gICAgICAgICAgYXdhaXQgZGVsZXRlRmlsZShwYXRoLmpvaW4odGhpcy5kaXJlY3RvcnksIGZuYW1lKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfVxufVxuLyogYzggaWdub3JlIHN0b3AgKi9cblxuLyoqXG4gKiBBbiBhY3F1aXJlZCBsb2NrXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUxvY2sge1xuICByZWxlYXNlKCk6IFByb21pc2U8dm9pZD47XG59XG5cbi8qKlxuICogQW4gYWNxdWlyZWQgd3JpdGVyIGxvY2tcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJV3JpdGVyTG9jayBleHRlbmRzIElMb2NrIHtcbiAgLyoqXG4gICAqIENvbnZlcnQgdGhlIHdyaXRlciBsb2NrIHRvIGEgcmVhZGVyIGxvY2tcbiAgICovXG4gIGNvbnZlcnRUb1JlYWRlckxvY2soKTogUHJvbWlzZTxJTG9jaz47XG59XG5cbi8qIGM4IGlnbm9yZSBzdGFydCAqLyAvLyBjb2RlIHBhdGhzIGFyZSB1bnByZWRpY3RhYmxlXG5hc3luYyBmdW5jdGlvbiByZWFkRmlsZUlmRXhpc3RzKGZpbGVuYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCBmcy5yZWFkRmlsZShmaWxlbmFtZSwgeyBlbmNvZGluZzogJ3V0Zi04JyB9KTtcbiAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgaWYgKGUuY29kZSA9PT0gJ0VOT0VOVCcpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHRocm93IGU7XG4gIH1cbn1cbi8qIGM4IGlnbm9yZSBzdG9wICovXG5cbmxldCB0bXBDb3VudGVyID0gMDtcbi8qIGM4IGlnbm9yZSBzdGFydCAqLyAvLyBjb2RlIHBhdGhzIGFyZSB1bnByZWRpY3RhYmxlXG5hc3luYyBmdW5jdGlvbiB3cml0ZUZpbGVBdG9taWMoZmlsZW5hbWU6IHN0cmluZywgY29udGVudHM6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBmcy5ta2RpcihwYXRoLmRpcm5hbWUoZmlsZW5hbWUpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgY29uc3QgdG1wRmlsZSA9IGAke2ZpbGVuYW1lfS4ke3Byb2Nlc3MucGlkfV8keysrdG1wQ291bnRlcn1gO1xuICBhd2FpdCBmcy53cml0ZUZpbGUodG1wRmlsZSwgY29udGVudHMsIHsgZW5jb2Rpbmc6ICd1dGYtOCcgfSk7XG4gIGF3YWl0IGZzLnJlbmFtZSh0bXBGaWxlLCBmaWxlbmFtZSk7XG59XG4vKiBjOCBpZ25vcmUgc3RvcCAqL1xuXG4vKiBjOCBpZ25vcmUgc3RhcnQgKi8gLy8gY29kZSBwYXRocyBhcmUgdW5wcmVkaWN0YWJsZVxuYXN5bmMgZnVuY3Rpb24gZGVsZXRlRmlsZShmaWxlbmFtZTogc3RyaW5nKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgZnMudW5saW5rKGZpbGVuYW1lKTtcbiAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgaWYgKGUuY29kZSA9PT0gJ0VOT0VOVCcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhyb3cgZTtcbiAgfVxufVxuLyogYzggaWdub3JlIHN0b3AgKi9cblxuLyogYzggaWdub3JlIHN0YXJ0ICovIC8vIGNvZGUgcGF0aHMgYXJlIHVucHJlZGljdGFibGVcbmZ1bmN0aW9uIHByb2Nlc3NFeGlzdHMocGlkOiBudW1iZXIpIHtcbiAgdHJ5IHtcbiAgICBwcm9jZXNzLmtpbGwocGlkLCAwKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuLyogYzggaWdub3JlIHN0b3AgKi9cbiJdfQ==