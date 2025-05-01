"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RWLock = void 0;
const fs_1 = require("fs");
const path = require("path");
const toolkit_error_1 = require("./toolkit-error");
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
    directory;
    pidString;
    writerFile;
    readCounter = 0;
    constructor(directory) {
        this.directory = directory;
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
        const readers = await this._currentReaders();
        if (readers.length > 0) {
            throw new toolkit_error_1.ToolkitError(`Other CLIs (PID=${readers}) are currently reading from ${this.directory}. Invoke the CLI in sequence, or use '--output' to synth into different directories.`);
        }
        await writeFileAtomic(this.writerFile, this.pidString);
        let released = false;
        return {
            release: async () => {
                // Releasing needs a flag, otherwise we might delete a file that some other lock has created in the mean time.
                if (!released) {
                    await deleteFile(this.writerFile);
                    released = true;
                }
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
        let released = false;
        return {
            release: async () => {
                // Releasing needs a flag, otherwise we might delete a file that some other lock has created in the mean time.
                if (!released) {
                    await deleteFile(readerFile);
                    released = true;
                }
            },
        };
    }
    async assertNoOtherWriters() {
        const writer = await this._currentWriter();
        if (writer) {
            throw new toolkit_error_1.ToolkitError(`Another CLI (PID=${writer}) is currently synthing to ${this.directory}. Invoke the CLI in sequence, or use '--output' to synth into different directories.`);
        }
    }
    /**
     * Check the current writer (if any)
     *
     * Publicly accessible for testing purposes. Do not use.
     *
     * @internal
     */
    async _currentWriter() {
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
     *
     * Publicly accessible for testing purposes. Do not use.
     *
     * @internal
     */
    async _currentReaders() {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicndsb2NrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2FwaS9yd2xvY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkJBQW9DO0FBQ3BDLDZCQUE2QjtBQUM3QixtREFBK0M7QUFFL0M7Ozs7Ozs7OztHQVNHO0FBQ0gscUJBQXFCLENBQUMsK0JBQStCO0FBQ3JELE1BQWEsTUFBTTtJQUtXO0lBSlgsU0FBUyxDQUFTO0lBQ2xCLFVBQVUsQ0FBUztJQUM1QixXQUFXLEdBQUcsQ0FBQyxDQUFDO0lBRXhCLFlBQTRCLFNBQWlCO1FBQWpCLGNBQVMsR0FBVCxTQUFTLENBQVE7UUFDM0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxHQUFHLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUVsQyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxZQUFZLENBQUMsQ0FBQztJQUM1RCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNJLEtBQUssQ0FBQyxZQUFZO1FBQ3ZCLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7UUFFbEMsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDN0MsSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSw0QkFBWSxDQUFDLG1CQUFtQixPQUFPLGdDQUFnQyxJQUFJLENBQUMsU0FBUyxzRkFBc0YsQ0FBQyxDQUFDO1FBQ3pMLENBQUM7UUFFRCxNQUFNLGVBQWUsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUV2RCxJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUM7UUFDckIsT0FBTztZQUNMLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbEIsOEdBQThHO2dCQUM5RyxJQUFJLENBQUMsUUFBUSxFQUFFLENB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QUFLLENBQUM7SUFDZixDQUFDO0FBQ0gsQ0FBQztBQUNELG9CQUFvQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHByb21pc2VzIGFzIGZzIH0gZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4vdG9vbGtpdC1lcnJvcic7XG5cbi8qKlxuICogQSBzaW5nbGUtd3JpdGVyL211bHRpLXJlYWRlciBsb2NrIG9uIGEgZGlyZWN0b3J5XG4gKlxuICogSXQgdXNlcyBtYXJrZXIgZmlsZXMgd2l0aCBQSURzIGluIHRoZW0gYXMgYSBsb2NraW5nIG1hcmtlcjsgdGhlIFBJRHMgd2lsbCBiZVxuICogY2hlY2tlZCBmb3IgbGl2ZW5lc3MsIHNvIHRoYXQgaWYgdGhlIHByb2Nlc3MgZXhpdHMgd2l0aG91dCBjbGVhbmluZyB1cCB0aGVcbiAqIGZpbGVzIHRoZSBsb2NrIGlzIGltcGxpY2l0bHkgcmVsZWFzZWQuXG4gKlxuICogVGhpcyBjbGFzcyBpcyBub3QgMTAwJSByYWNlIHNhZmUsIGJ1dCBpbiBwcmFjdGljZSBpdCBzaG91bGQgYmUgYSBsb3RcbiAqIGJldHRlciB0aGFuIHRoZSAwIHByb3RlY3Rpb24gd2UgaGF2ZSB0b2RheS5cbiAqL1xuLyogYzggaWdub3JlIHN0YXJ0ICovIC8vIGNvZGUgcGF0aHMgYXJlIHVucHJlZGljdGFibGVcbmV4cG9ydCBjbGFzcyBSV0xvY2sge1xuICBwcml2YXRlIHJlYWRvbmx5IHBpZFN0cmluZzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHdyaXRlckZpbGU6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkQ291bnRlciA9IDA7XG5cbiAgY29uc3RydWN0b3IocHVibGljIHJlYWRvbmx5IGRpcmVjdG9yeTogc3RyaW5nKSB7XG4gICAgdGhpcy5waWRTdHJpbmcgPSBgJHtwcm9jZXNzLnBpZH1gO1xuXG4gICAgdGhpcy53cml0ZXJGaWxlID0gcGF0aC5qb2luKHRoaXMuZGlyZWN0b3J5LCAnc3ludGgubG9jaycpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmUgYSB3cml0ZXIgbG9jay5cbiAgICpcbiAgICogTm8gb3RoZXIgcmVhZGVycyBvciB3cml0ZXJzIG11c3QgZXhpc3QgZm9yIHRoZSBnaXZlbiBkaXJlY3RvcnkuXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgYWNxdWlyZVdyaXRlKCk6IFByb21pc2U8SVdyaXRlTG9jaz4ge1xuICAgIGF3YWl0IHRoaXMuYXNzZXJ0Tm9PdGhlcldyaXRlcnMoKTtcblxuICAgIGNvbnN0IHJlYWRlcnMgPSBhd2FpdCB0aGlzLl9jdXJyZW50UmVhZGVycygpO1xuICAgIGlmIChyZWFkZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYE90aGVyIENMSXMgKFBJRD0ke3JlYWRlcnN9KSBhcmUgY3VycmVudGx5IHJlYWRpbmcgZnJvbSAke3RoaXMuZGlyZWN0b3J5fS4gSW52b2tlIHRoZSBDTEkgaW4gc2VxdWVuY2UsIG9yIHVzZSAnLS1vdXRwdXQnIHRvIHN5bnRoIGludG8gZGlmZmVyZW50IGRpcmVjdG9yaWVzLmApO1xuICAgIH1cblxuICAgIGF3YWl0IHdyaXRlRmlsZUF0b21pYyh0aGlzLndyaXRlckZpbGUsIHRoaXMucGlkU3RyaW5nKTtcblxuICAgIGxldCByZWxlYXNlZCA9IGZhbHNlO1xuICAgIHJldHVybiB7XG4gICAgICByZWxlYXNlOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIFJlbGVhc2luZyBuZWVkcyBhIGZsYWcsIG90aGVyd2lzZSB3ZSBtaWdodCBkZWxldGUgYSBmaWxlIHRoYXQgc29tZSBvdGhlciBsb2NrIGhhcyBjcmVhdGVkIGluIHRoZSBtZWFuIHRpbWUuXG4gICAgICAgIGlmICghcmVsZWFzZWQpIHtcbiAgICAgICAgICBhd2FpdCBkZWxldGVGaWxlKHRoaXMud3JpdGVyRmlsZSk7XG4gICAgICAgICAgcmVsZWFzZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgY29udmVydFRvUmVhZGVyTG9jazogYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBBY3F1aXJlIHRoZSByZWFkIGxvY2sgYmVmb3JlIHJlbGVhc2luZyB0aGUgd3JpdGUgbG9jay4gU2xpZ2h0bHkgbGVzc1xuICAgICAgICAvLyBjaGFuY2Ugb2YgcmFjaW5nIVxuICAgICAgICBjb25zdCByZXQgPSBhd2FpdCB0aGlzLmRvQWNxdWlyZVJlYWQoKTtcbiAgICAgICAgYXdhaXQgZGVsZXRlRmlsZSh0aGlzLndyaXRlckZpbGUpO1xuICAgICAgICByZXR1cm4gcmV0O1xuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEFjcXVpcmUgYSByZWFkIGxvY2tcbiAgICpcbiAgICogV2lsbCBmYWlsIGlmIHRoZXJlIGFyZSBhbnkgd3JpdGVycy5cbiAgICovXG4gIHB1YmxpYyBhc3luYyBhY3F1aXJlUmVhZCgpOiBQcm9taXNlPElSZWFkTG9jaz4ge1xuICAgIGF3YWl0IHRoaXMuYXNzZXJ0Tm9PdGhlcldyaXRlcnMoKTtcbiAgICByZXR1cm4gdGhpcy5kb0FjcXVpcmVSZWFkKCk7XG4gIH1cblxuICAvKipcbiAgICogT2J0YWlucyB0aGUgbmFtZSBmbyBhIChuZXcpIGByZWFkZXJGaWxlYCB0byB1c2UuIFRoaXMgaW5jbHVkZXMgYSBjb3VudGVyIHNvXG4gICAqIHRoYXQgaWYgbXVsdGlwbGUgdGhyZWFkcyBvZiB0aGUgc2FtZSBQSUQgYXR0ZW1wdCB0byBjb25jdXJyZW50bHkgYWNxdWlyZVxuICAgKiB0aGUgc2FtZSBsb2NrLCB0aGV5J3JlIGd1YXJhbnRlZWQgdG8gdXNlIGEgZGlmZmVyZW50IHJlYWRlciBmaWxlIG5hbWUgKG9ubHlcbiAgICogb25lIHRocmVhZCB3aWxsIGV2ZXIgZXhlY3V0ZSBKUyBjb2RlIGF0IG9uY2UsIGd1YXJhbnRlZWluZyB0aGUgcmVhZENvdW50ZXJcbiAgICogaXMgaW5jcmVtZW50ZWQgXCJhdG9taWNhbGx5XCIgZnJvbSB0aGUgcG9pbnQgb2YgdmlldyBvZiB0aGlzIFBJRC4pLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkZXJGaWxlKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHBhdGguam9pbih0aGlzLmRpcmVjdG9yeSwgYHJlYWQuJHt0aGlzLnBpZFN0cmluZ30uJHsrK3RoaXMucmVhZENvdW50ZXJ9LmxvY2tgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEbyB0aGUgYWN0dWFsIGFjcXVpcmluZyBvZiBhIHJlYWQgbG9jay5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZG9BY3F1aXJlUmVhZCgpOiBQcm9taXNlPElSZWFkTG9jaz4ge1xuICAgIGNvbnN0IHJlYWRlckZpbGUgPSB0aGlzLnJlYWRlckZpbGUoKTtcbiAgICBhd2FpdCB3cml0ZUZpbGVBdG9taWMocmVhZGVyRmlsZSwgdGhpcy5waWRTdHJpbmcpO1xuXG4gICAgbGV0IHJlbGVhc2VkID0gZmFsc2U7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlbGVhc2U6IGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gUmVsZWFzaW5nIG5lZWRzIGEgZmxhZywgb3RoZXJ3aXNlIHdlIG1pZ2h0IGRlbGV0ZSBhIGZpbGUgdGhhdCBzb21lIG90aGVyIGxvY2sgaGFzIGNyZWF0ZWQgaW4gdGhlIG1lYW4gdGltZS5cbiAgICAgICAgaWYgKCFyZWxlYXNlZCkge1xuICAgICAgICAgIGF3YWl0IGRlbGV0ZUZpbGUocmVhZGVyRmlsZSk7XG4gICAgICAgICAgcmVsZWFzZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFzc2VydE5vT3RoZXJXcml0ZXJzKCkge1xuICAgIGNvbnN0IHdyaXRlciA9IGF3YWl0IHRoaXMuX2N1cnJlbnRXcml0ZXIoKTtcbiAgICBpZiAod3JpdGVyKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBBbm90aGVyIENMSSAoUElEPSR7d3JpdGVyfSkgaXMgY3VycmVudGx5IHN5bnRoaW5nIHRvICR7dGhpcy5kaXJlY3Rvcnl9LiBJbnZva2UgdGhlIENMSSBpbiBzZXF1ZW5jZSwgb3IgdXNlICctLW91dHB1dCcgdG8gc3ludGggaW50byBkaWZmZXJlbnQgZGlyZWN0b3JpZXMuYCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIHRoZSBjdXJyZW50IHdyaXRlciAoaWYgYW55KVxuICAgKlxuICAgKiBQdWJsaWNseSBhY2Nlc3NpYmxlIGZvciB0ZXN0aW5nIHB1cnBvc2VzLiBEbyBub3QgdXNlLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBhc3luYyBfY3VycmVudFdyaXRlcigpOiBQcm9taXNlPG51bWJlciB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IGNvbnRlbnRzID0gYXdhaXQgcmVhZEZpbGVJZkV4aXN0cyh0aGlzLndyaXRlckZpbGUpO1xuICAgIGlmICghY29udGVudHMpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgcGlkID0gcGFyc2VJbnQoY29udGVudHMsIDEwKTtcbiAgICBpZiAoIXByb2Nlc3NFeGlzdHMocGlkKSkge1xuICAgICAgLy8gRG8gY2xlYW51cCBvZiBhIHN0cmF5IGZpbGUgbm93XG4gICAgICBhd2FpdCBkZWxldGVGaWxlKHRoaXMud3JpdGVyRmlsZSk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiBwaWQ7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgdGhlIGN1cnJlbnQgcmVhZGVycyAoaWYgYW55KVxuICAgKlxuICAgKiBQdWJsaWNseSBhY2Nlc3NpYmxlIGZvciB0ZXN0aW5nIHB1cnBvc2VzLiBEbyBub3QgdXNlLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBhc3luYyBfY3VycmVudFJlYWRlcnMoKTogUHJvbWlzZTxudW1iZXJbXT4ge1xuICAgIGNvbnN0IHJlID0gL15yZWFkXFwuKFteLl0rKVxcLlteLl0rXFwubG9jayQvO1xuICAgIGNvbnN0IHJldCA9IG5ldyBBcnJheTxudW1iZXI+KCk7XG5cbiAgICBsZXQgY2hpbGRyZW47XG4gICAgdHJ5IHtcbiAgICAgIGNoaWxkcmVuID0gYXdhaXQgZnMucmVhZGRpcih0aGlzLmRpcmVjdG9yeSwgeyBlbmNvZGluZzogJ3V0Zi04JyB9KTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIC8vIENhbid0IGJlIGxvY2tlZCBpZiB0aGUgZGlyZWN0b3J5IGRvZXNuJ3QgZXhpc3RcbiAgICAgIGlmIChlLmNvZGUgPT09ICdFTk9FTlQnKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmbmFtZSBvZiBjaGlsZHJlbikge1xuICAgICAgY29uc3QgbSA9IGZuYW1lLm1hdGNoKHJlKTtcbiAgICAgIGlmIChtKSB7XG4gICAgICAgIGNvbnN0IHBpZCA9IHBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICAgICAgaWYgKHByb2Nlc3NFeGlzdHMocGlkKSkge1xuICAgICAgICAgIHJldC5wdXNoKHBpZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRG8gY2xlYW51cCBvZiBhIHN0cmF5IGZpbGUgbm93XG4gICAgICAgICAgYXdhaXQgZGVsZXRlRmlsZShwYXRoLmpvaW4odGhpcy5kaXJlY3RvcnksIGZuYW1lKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfVxufVxuLyogYzggaWdub3JlIHN0b3AgKi9cblxuLyoqXG4gKiBBbiBhY3F1aXJlZCBsb2NrXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVJlYWRMb2NrIHtcbiAgLyoqXG4gICAqIFJlbGVhc2UgdGhlIGxvY2suIENhbiBiZSBjYWxsZWQgbW9yZSB0aGFuIG9uY2UuXG4gICAqL1xuICByZWxlYXNlKCk6IFByb21pc2U8dm9pZD47XG59XG5cbi8qKlxuICogQW4gYWNxdWlyZWQgd3JpdGVyIGxvY2tcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJV3JpdGVMb2NrIGV4dGVuZHMgSVJlYWRMb2NrIHtcbiAgLyoqXG4gICAqIENvbnZlcnQgdGhlIHdyaXRlciBsb2NrIHRvIGEgcmVhZGVyIGxvY2tcbiAgICovXG4gIGNvbnZlcnRUb1JlYWRlckxvY2soKTogUHJvbWlzZTxJUmVhZExvY2s+O1xufVxuXG4vKiBjOCBpZ25vcmUgc3RhcnQgKi8gLy8gY29kZSBwYXRocyBhcmUgdW5wcmVkaWN0YWJsZVxuYXN5bmMgZnVuY3Rpb24gcmVhZEZpbGVJZkV4aXN0cyhmaWxlbmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgZnMucmVhZEZpbGUoZmlsZW5hbWUsIHsgZW5jb2Rpbmc6ICd1dGYtOCcgfSk7XG4gIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgIGlmIChlLmNvZGUgPT09ICdFTk9FTlQnKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICB0aHJvdyBlO1xuICB9XG59XG4vKiBjOCBpZ25vcmUgc3RvcCAqL1xuXG5sZXQgdG1wQ291bnRlciA9IDA7XG4vKiBjOCBpZ25vcmUgc3RhcnQgKi8gLy8gY29kZSBwYXRocyBhcmUgdW5wcmVkaWN0YWJsZVxuYXN5bmMgZnVuY3Rpb24gd3JpdGVGaWxlQXRvbWljKGZpbGVuYW1lOiBzdHJpbmcsIGNvbnRlbnRzOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgZnMubWtkaXIocGF0aC5kaXJuYW1lKGZpbGVuYW1lKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGNvbnN0IHRtcEZpbGUgPSBgJHtmaWxlbmFtZX0uJHtwcm9jZXNzLnBpZH1fJHsrK3RtcENvdW50ZXJ9YDtcbiAgYXdhaXQgZnMud3JpdGVGaWxlKHRtcEZpbGUsIGNvbnRlbnRzLCB7IGVuY29kaW5nOiAndXRmLTgnIH0pO1xuICBhd2FpdCBmcy5yZW5hbWUodG1wRmlsZSwgZmlsZW5hbWUpO1xufVxuLyogYzggaWdub3JlIHN0b3AgKi9cblxuLyogYzggaWdub3JlIHN0YXJ0ICovIC8vIGNvZGUgcGF0aHMgYXJlIHVucHJlZGljdGFibGVcbmFzeW5jIGZ1bmN0aW9uIGRlbGV0ZUZpbGUoZmlsZW5hbWU6IHN0cmluZykge1xuICB0cnkge1xuICAgIGF3YWl0IGZzLnVubGluayhmaWxlbmFtZSk7XG4gIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgIGlmIChlLmNvZGUgPT09ICdFTk9FTlQnKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRocm93IGU7XG4gIH1cbn1cbi8qIGM4IGlnbm9yZSBzdG9wICovXG5cbi8qIGM4IGlnbm9yZSBzdGFydCAqLyAvLyBjb2RlIHBhdGhzIGFyZSB1bnByZWRpY3RhYmxlXG5mdW5jdGlvbiBwcm9jZXNzRXhpc3RzKHBpZDogbnVtYmVyKSB7XG4gIHRyeSB7XG4gICAgcHJvY2Vzcy5raWxsKHBpZCwgMCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cbi8qIGM4IGlnbm9yZSBzdG9wICovXG4iXX0=