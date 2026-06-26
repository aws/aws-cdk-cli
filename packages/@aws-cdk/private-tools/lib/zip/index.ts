import { createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import type { Options } from 'fast-glob';
import { globSync } from 'fast-glob';
import { ZipFile } from 'yazl';

/**
 * The fixed timestamp applied to every entry so that equal content yields an
 * equal zip (deterministic output, stable content hash).
 *
 * It is built lazily (per call) from *local* date components rather than from a
 * UTC instant (e.g. `new Date('1980-01-01T00:00:00Z')`). yazl derives the ZIP
 * "DOS" timestamp from the local-time fields of this `Date`, so local
 * components yield the same DOS value (1980-01-01 00:00:00) on every machine
 * regardless of its timezone. Constructing it lazily (instead of as a
 * module-load constant) means it reflects the process timezone at call time,
 * which keeps the behavior identical in production while remaining observable
 * to tests that simulate a timezone. Combined with `forceDosTimestamp`, the
 * produced archive is byte-for-byte identical across timezones, which the asset
 * hashing relies on.
 */
function epoch(): Date {
  return new Date(1980, 0, 1, 0, 0, 0);
}

/**
 * Receives informational messages (e.g. retries on EPERM on Windows).
 */
export type EventEmitter = (x: string) => void;

/**
 * Zip the contents of a directory into the given output file.
 *
 * The resulting zip is deterministic: file dates are reset to a fixed
 * epoch so equal content produces equal zip files.
 *
 * Follows symbolic links.
 *
 * @param directory    - The directory to zip.
 * @param outputFile   - The target zip file path.
 * @param eventEmitter - Optional sink for informational messages.
 */
export async function zipDirectory(
  directory: string,
  outputFile: string,
  eventEmitter: EventEmitter = () => {
  },
): Promise<void> {
  // We write to a temporary file and rename at the last moment. This is so that if we are
  // interrupted during this process, we don't leave a half-finished file in the target location.
  const temporaryOutputFile = `${outputFile}.${randomString()}._tmp`;
  await writeZipFile(directory, temporaryOutputFile);
  await moveIntoPlace(temporaryOutputFile, outputFile, eventEmitter);
}

/**
 * Compress a string as a single-file zip, returning the zip buffer.
 *
 * The resulting zip is deterministic: the file date is reset to a fixed epoch.
 *
 * @see https://github.com/archiverjs/node-archiver/issues/342
 */
export function zipString(fileName: string, rawString: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];

    const zip = new ZipFile();
    zip.outputStream.on('data', (chunk: Buffer) => buffers.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(buffers)));

    zip.addBuffer(Buffer.from(rawString), fileName, {
      mtime: epoch(), // reset date to get the same hash for the same content
      // Only emit the DOS timestamp (no UTC "universal time" extended field),
      // so the archive bytes do not depend on the machine's timezone.
      forceDosTimestamp: true,
    });
    zip.end();
  });
}

function writeZipFile(directory: string, outputFile: string): Promise<void> {
  return new Promise(async (ok, fail) => {
    // The below options are needed to support following symlinks when building zip files:
    // - onlyFiles: This will prevent symlinks themselves from being copied into the zip.
    // - followSymbolicLinks: This will follow symlinks and copy the files within.
    const globOptions: Options = {
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: true,
      cwd: directory,
    };
    const files = globSync('**', globOptions); // The output here is already sorted

    const zip = new ZipFile();
    zip.outputStream.on('error', fail);

    const output = createWriteStream(outputFile);
    output.on('error', fail);
    // resolve once the output file descriptor has closed
    output.once('close', ok);

    zip.outputStream.pipe(output);

    // Append files serially to ensure file order
    for (const file of files) {
      const fullPath = path.resolve(directory, file);
      // There are exactly 2 promises
      // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
      const [data, stat] = await Promise.all([fs.readFile(fullPath), fs.stat(fullPath)]);
      zip.addBuffer(data, file, {
        mtime: epoch(), // reset dates to get the same hash for the same content
        mode: stat.mode,
        // Only emit the DOS timestamp (no UTC "universal time" extended field),
        // so the archive bytes do not depend on the machine's timezone.
        forceDosTimestamp: true,
      });
    }

    zip.end();
  });
}

/**
 * Rename the file to the target location, taking into account:
 *
 * - That we may see EPERM on Windows while an Antivirus scanner still has the
 *   file open, so retry a couple of times.
 * - This same function may be called in parallel and be interrupted at any point.
 */
async function moveIntoPlace(source: string, target: string, eventEmitter: EventEmitter) {
  let delay = 100;
  let attempts = 5;
  while (true) {
    try {
      // 'rename' is guaranteed to overwrite an existing target, as long as it is a file (not a directory)
      await fs.rename(source, target);
      return;
    } catch (e: any) {
      if (e.code !== 'EPERM' || attempts-- <= 0) {
        throw e;
      }
      eventEmitter(e.message);
      await sleep(Math.floor(Math.random() * delay));
      delay *= 2;
    }
  }
}

function sleep(ms: number) {
  return new Promise((ok) => setTimeout(ok, ms));
}

function randomString() {
  return Math.random()
    .toString(36)
    .replace(/[^a-z0-9]+/g, '');
}
