"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zipDirectory = zipDirectory;
const console_1 = require("console");
const fs_1 = require("fs");
const path = require("path");
const glob = require("glob");
const format_error_1 = require("./format-error");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');
// Adapted from cdk-assets
async function zipDirectory(directory, outputFile) {
    // We write to a temporary file and rename at the last moment. This is so that if we are
    // interrupted during this process, we don't leave a half-finished file in the target location.
    const temporaryOutputFile = `${outputFile}.${randomString()}._tmp`;
    await writeZipFile(directory, temporaryOutputFile);
    await moveIntoPlace(temporaryOutputFile, outputFile);
}
function writeZipFile(directory, outputFile) {
    return new Promise(async (ok, fail) => {
        // The below options are needed to support following symlinks when building zip files:
        // - nodir: This will prevent symlinks themselves from being copied into the zip.
        // - follow: This will follow symlinks and copy the files within.
        const globOptions = {
            dot: true,
            nodir: true,
            follow: true,
            cwd: directory,
        };
        const files = glob.sync('**', globOptions); // The output here is already sorted
        const output = (0, fs_1.createWriteStream)(outputFile);
        const archive = archiver('zip');
        archive.on('warning', fail);
        archive.on('error', fail);
        // archive has been finalized and the output file descriptor has closed, resolve promise
        // this has to be done before calling `finalize` since the events may fire immediately after.
        // see https://www.npmjs.com/package/archiver
        output.once('close', ok);
        archive.pipe(output);
        // Append files serially to ensure file order
        for (const file of files) {
            const fullPath = path.resolve(directory, file);
            // Exactly 2 promises
            // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
            const [data, stat] = await Promise.all([fs_1.promises.readFile(fullPath), fs_1.promises.stat(fullPath)]);
            archive.append(data, {
                name: file,
                mode: stat.mode,
            });
        }
        await archive.finalize();
    });
}
/**
 * Rename the file to the target location, taking into account:
 *
 * - That we may see EPERM on Windows while an Antivirus scanner still has the
 *   file open, so retry a couple of times.
 * - This same function may be called in parallel and be interrupted at any point.
 */
async function moveIntoPlace(source, target) {
    let delay = 100;
    let attempts = 5;
    while (true) {
        try {
            // 'rename' is guaranteed to overwrite an existing target, as long as it is a file (not a directory)
            await fs_1.promises.rename(source, target);
            return;
        }
        catch (e) {
            if (e.code !== 'EPERM' || attempts-- <= 0) {
                throw e;
            }
            (0, console_1.error)((0, format_error_1.formatErrorMessage)(e));
            await sleep(Math.floor(Math.random() * delay));
            delay *= 2;
        }
    }
}
function sleep(ms) {
    return new Promise(ok => setTimeout(ok, ms));
}
function randomString() {
    return Math.random().toString(36).replace(/[^a-z0-9]+/g, '');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXJjaGl2ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy91dGlsL2FyY2hpdmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFVQSxvQ0FNQztBQWhCRCxxQ0FBZ0M7QUFDaEMsMkJBQXVEO0FBQ3ZELDZCQUE2QjtBQUM3Qiw2QkFBNkI7QUFDN0IsaURBQW9EO0FBRXBELGlFQUFpRTtBQUNqRSxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7QUFFckMsMEJBQTBCO0FBQ25CLEtBQUssVUFBVSxZQUFZLENBQUMsU0FBaUIsRUFBRSxVQUFrQjtJQUN0RSx3RkFBd0Y7SUFDeEYsK0ZBQStGO0lBQy9GLE1BQU0sbUJBQW1CLEdBQUcsR0FBRyxVQUFVLElBQUksWUFBWSxFQUFFLE9BQU8sQ0FBQztJQUNuRSxNQUFNLFlBQVksQ0FBQyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztJQUNuRCxNQUFNLGFBQWEsQ0FBQyxtQkFBbUIsRUFBRSxVQUFVLENBQUMsQ0FBQztBQUN2RCxDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsU0FBaUIsRUFBRSxVQUFrQjtJQUN6RCxPQUFPLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUU7UUFDcEMsc0ZBQXNGO1FBQ3RGLGlGQUFpRjtRQUNqRixpRUFBaUU7UUFDakUsTUFBTSxXQUFXLEdBQUc7WUFDbEIsR0FBRyxFQUFFLElBQUk7WUFDVCxLQUFLLEVBQUUsSUFBSTtZQUNYLE1BQU0sRUFBRSxJQUFJO1lBQ1osR0FBRyxFQUFFLFNBQVM7U0FDZixDQUFDO1FBQ0YsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUMsQ0FBQyxvQ0FBb0M7UUFFaEYsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBaUIsRUFBQyxVQUFVLENBQUMsQ0FBQztRQUU3QyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDaEMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDNUIsT0FBTyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFMUIsd0ZBQXdGO1FBQ3hGLDZGQUE2RjtRQUM3Riw2Q0FBNkM7UUFDN0MsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFekIsT0FBTyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUVyQiw2Q0FBNkM7UUFDN0MsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUN6QixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztZQUMvQyxxQkFBcUI7WUFDckIsd0VBQXdFO1lBQ3hFLE1BQU0sQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsYUFBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsRUFBRSxhQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNuRixPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRTtnQkFDbkIsSUFBSSxFQUFFLElBQUk7Z0JBQ1YsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO2FBQ2hCLENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCxNQUFNLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztJQUMzQixDQUFDLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxLQUFLLFVBQVUsYUFBYSxDQUFDLE1BQWMsRUFBRSxNQUFjO0lBQ3pELElBQUksS0FBSyxHQUFHLEdBQUcsQ0FBQztJQUNoQixJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7SUFDakIsT0FBTyxJQUFJLEVBQUUsQ0FBQztRQUNaLElBQUksQ0FBQztZQUNILG9HQUFvRztZQUNwRyxNQUFNLGFBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQ2hDLE9BQU87UUFDVCxDQUFDO1FBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztZQUNoQixJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssT0FBTyxJQUFJLFFBQVEsRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUMxQyxNQUFNLENBQUMsQ0FBQztZQUNWLENBQUM7WUFDRCxJQUFBLGVBQUssRUFBQyxJQUFBLGlDQUFrQixFQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDN0IsTUFBTSxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUMvQyxLQUFLLElBQUksQ0FBQyxDQUFDO1FBQ2IsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDO0FBRUQsU0FBUyxLQUFLLENBQUMsRUFBVTtJQUN2QixPQUFPLElBQUksT0FBTyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQy9DLENBQUM7QUFFRCxTQUFTLFlBQVk7SUFDbkIsT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLEVBQUUsRUFBRSxDQUFDLENBQUM7QUFDL0QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGVycm9yIH0gZnJvbSAnY29uc29sZSc7XG5pbXBvcnQgeyBjcmVhdGVXcml0ZVN0cmVhbSwgcHJvbWlzZXMgYXMgZnMgfSBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZ2xvYiBmcm9tICdnbG9iJztcbmltcG9ydCB7IGZvcm1hdEVycm9yTWVzc2FnZSB9IGZyb20gJy4vZm9ybWF0LWVycm9yJztcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHNcbmNvbnN0IGFyY2hpdmVyID0gcmVxdWlyZSgnYXJjaGl2ZXInKTtcblxuLy8gQWRhcHRlZCBmcm9tIGNkay1hc3NldHNcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB6aXBEaXJlY3RvcnkoZGlyZWN0b3J5OiBzdHJpbmcsIG91dHB1dEZpbGU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAvLyBXZSB3cml0ZSB0byBhIHRlbXBvcmFyeSBmaWxlIGFuZCByZW5hbWUgYXQgdGhlIGxhc3QgbW9tZW50LiBUaGlzIGlzIHNvIHRoYXQgaWYgd2UgYXJlXG4gIC8vIGludGVycnVwdGVkIGR1cmluZyB0aGlzIHByb2Nlc3MsIHdlIGRvbid0IGxlYXZlIGEgaGFsZi1maW5pc2hlZCBmaWxlIGluIHRoZSB0YXJnZXQgbG9jYXRpb24uXG4gIGNvbnN0IHRlbXBvcmFyeU91dHB1dEZpbGUgPSBgJHtvdXRwdXRGaWxlfS4ke3JhbmRvbVN0cmluZygpfS5fdG1wYDtcbiAgYXdhaXQgd3JpdGVaaXBGaWxlKGRpcmVjdG9yeSwgdGVtcG9yYXJ5T3V0cHV0RmlsZSk7XG4gIGF3YWl0IG1vdmVJbnRvUGxhY2UodGVtcG9yYXJ5T3V0cHV0RmlsZSwgb3V0cHV0RmlsZSk7XG59XG5cbmZ1bmN0aW9uIHdyaXRlWmlwRmlsZShkaXJlY3Rvcnk6IHN0cmluZywgb3V0cHV0RmlsZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAob2ssIGZhaWwpID0+IHtcbiAgICAvLyBUaGUgYmVsb3cgb3B0aW9ucyBhcmUgbmVlZGVkIHRvIHN1cHBvcnQgZm9sbG93aW5nIHN5bWxpbmtzIHdoZW4gYnVpbGRpbmcgemlwIGZpbGVzOlxuICAgIC8vIC0gbm9kaXI6IFRoaXMgd2lsbCBwcmV2ZW50IHN5bWxpbmtzIHRoZW1zZWx2ZXMgZnJvbSBiZWluZyBjb3BpZWQgaW50byB0aGUgemlwLlxuICAgIC8vIC0gZm9sbG93OiBUaGlzIHdpbGwgZm9sbG93IHN5bWxpbmtzIGFuZCBjb3B5IHRoZSBmaWxlcyB3aXRoaW4uXG4gICAgY29uc3QgZ2xvYk9wdGlvbnMgPSB7XG4gICAgICBkb3Q6IHRydWUsXG4gICAgICBub2RpcjogdHJ1ZSxcbiAgICAgIGZvbGxvdzogdHJ1ZSxcbiAgICAgIGN3ZDogZGlyZWN0b3J5LFxuICAgIH07XG4gICAgY29uc3QgZmlsZXMgPSBnbG9iLnN5bmMoJyoqJywgZ2xvYk9wdGlvbnMpOyAvLyBUaGUgb3V0cHV0IGhlcmUgaXMgYWxyZWFkeSBzb3J0ZWRcblxuICAgIGNvbnN0IG91dHB1dCA9IGNyZWF0ZVdyaXRlU3RyZWFtKG91dHB1dEZpbGUpO1xuXG4gICAgY29uc3QgYXJjaGl2ZSA9IGFyY2hpdmVyKCd6aXAnKTtcbiAgICBhcmNoaXZlLm9uKCd3YXJuaW5nJywgZmFpbCk7XG4gICAgYXJjaGl2ZS5vbignZXJyb3InLCBmYWlsKTtcblxuICAgIC8vIGFyY2hpdmUgaGFzIGJlZW4gZmluYWxpemVkIGFuZCB0aGUgb3V0cHV0IGZpbGUgZGVzY3JpcHRvciBoYXMgY2xvc2VkLCByZXNvbHZlIHByb21pc2VcbiAgICAvLyB0aGlzIGhhcyB0byBiZSBkb25lIGJlZm9yZSBjYWxsaW5nIGBmaW5hbGl6ZWAgc2luY2UgdGhlIGV2ZW50cyBtYXkgZmlyZSBpbW1lZGlhdGVseSBhZnRlci5cbiAgICAvLyBzZWUgaHR0cHM6Ly93d3cubnBtanMuY29tL3BhY2thZ2UvYXJjaGl2ZXJcbiAgICBvdXRwdXQub25jZSgnY2xvc2UnLCBvayk7XG5cbiAgICBhcmNoaXZlLnBpcGUob3V0cHV0KTtcblxuICAgIC8vIEFwcGVuZCBmaWxlcyBzZXJpYWxseSB0byBlbnN1cmUgZmlsZSBvcmRlclxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgY29uc3QgZnVsbFBhdGggPSBwYXRoLnJlc29sdmUoZGlyZWN0b3J5LCBmaWxlKTtcbiAgICAgIC8vIEV4YWN0bHkgMiBwcm9taXNlc1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEBjZGtsYWJzL3Byb21pc2VhbGwtbm8tdW5ib3VuZGVkLXBhcmFsbGVsaXNtXG4gICAgICBjb25zdCBbZGF0YSwgc3RhdF0gPSBhd2FpdCBQcm9taXNlLmFsbChbZnMucmVhZEZpbGUoZnVsbFBhdGgpLCBmcy5zdGF0KGZ1bGxQYXRoKV0pO1xuICAgICAgYXJjaGl2ZS5hcHBlbmQoZGF0YSwge1xuICAgICAgICBuYW1lOiBmaWxlLFxuICAgICAgICBtb2RlOiBzdGF0Lm1vZGUsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCBhcmNoaXZlLmZpbmFsaXplKCk7XG4gIH0pO1xufVxuXG4vKipcbiAqIFJlbmFtZSB0aGUgZmlsZSB0byB0aGUgdGFyZ2V0IGxvY2F0aW9uLCB0YWtpbmcgaW50byBhY2NvdW50OlxuICpcbiAqIC0gVGhhdCB3ZSBtYXkgc2VlIEVQRVJNIG9uIFdpbmRvd3Mgd2hpbGUgYW4gQW50aXZpcnVzIHNjYW5uZXIgc3RpbGwgaGFzIHRoZVxuICogICBmaWxlIG9wZW4sIHNvIHJldHJ5IGEgY291cGxlIG9mIHRpbWVzLlxuICogLSBUaGlzIHNhbWUgZnVuY3Rpb24gbWF5IGJlIGNhbGxlZCBpbiBwYXJhbGxlbCBhbmQgYmUgaW50ZXJydXB0ZWQgYXQgYW55IHBvaW50LlxuICovXG5hc3luYyBmdW5jdGlvbiBtb3ZlSW50b1BsYWNlKHNvdXJjZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZykge1xuICBsZXQgZGVsYXkgPSAxMDA7XG4gIGxldCBhdHRlbXB0cyA9IDU7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgdHJ5IHtcbiAgICAgIC8vICdyZW5hbWUnIGlzIGd1YXJhbnRlZWQgdG8gb3ZlcndyaXRlIGFuIGV4aXN0aW5nIHRhcmdldCwgYXMgbG9uZyBhcyBpdCBpcyBhIGZpbGUgKG5vdCBhIGRpcmVjdG9yeSlcbiAgICAgIGF3YWl0IGZzLnJlbmFtZShzb3VyY2UsIHRhcmdldCk7XG4gICAgICByZXR1cm47XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICBpZiAoZS5jb2RlICE9PSAnRVBFUk0nIHx8IGF0dGVtcHRzLS0gPD0gMCkge1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuICAgICAgZXJyb3IoZm9ybWF0RXJyb3JNZXNzYWdlKGUpKTtcbiAgICAgIGF3YWl0IHNsZWVwKE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIGRlbGF5KSk7XG4gICAgICBkZWxheSAqPSAyO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBzbGVlcChtczogbnVtYmVyKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZShvayA9PiBzZXRUaW1lb3V0KG9rLCBtcykpO1xufVxuXG5mdW5jdGlvbiByYW5kb21TdHJpbmcoKSB7XG4gIHJldHVybiBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5yZXBsYWNlKC9bXmEtejAtOV0rL2csICcnKTtcbn1cbiJdfQ==