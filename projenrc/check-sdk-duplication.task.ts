/* eslint-disable no-console */
/**
 * Build-time check that inspects yarn.lock for excessive duplication of
 * @aws-sdk/ and @smithy/ packages.
 *
 * Duplication means the lockfile resolves multiple distinct versions of the
 * same package name. This wastes disk space, increases bundle sizes, and
 * multiplies per-process memory usage (each version is a separate module
 * instance in the Node.js module cache).
 *
 * Run: tsx projenrc/check-sdk-duplication.task.ts
 */
import { promises as fs } from 'fs';
import * as path from 'path';
// eslint-disable-next-line import/no-extraneous-dependencies
import { parseSyml } from '@yarnpkg/parsers';

/**
 * Maximum number of distinct resolved versions allowed per package.
 * If any @aws-sdk/ or @smithy/ package exceeds this, the check fails.
 */
const MAX_ALLOWED_DUPLICATES = 1;

/**
 * Package name prefixes to check for duplication.
 */
const CHECKED_PREFIXES = ['@aws-sdk/', '@smithy/'];

interface DuplicationInfo {
  packageName: string;
  versions: string[];
}

/**
 * Extract package name from a Berry resolution string like "@aws-sdk/core@npm:3.974.26"
 */
function parseResolutionField(resolution: string): { name: string; version: string } | undefined {
  const match = resolution.match(/^(.+)@npm:(.+)$/);
  if (!match) return undefined;
  return { name: match[1], version: match[2] };
}

/**
 * Parse a Yarn 4 lockfile and count resolved versions per package name
 * for packages matching the checked prefixes.
 */
function countResolvedVersions(lockfileContent: string): Map<string, Set<string>> {
  const parsed = parseSyml(lockfileContent);
  const packageVersions = new Map<string, Set<string>>();

  for (const [key, entry] of Object.entries(parsed)) {
    if (key === '__metadata' || !entry?.resolution) continue;

    const resolved = parseResolutionField(entry.resolution);
    if (!resolved) continue;

    if (!CHECKED_PREFIXES.some((prefix) => resolved.name.startsWith(prefix))) {
      continue;
    }

    let versions = packageVersions.get(resolved.name);
    if (!versions) {
      versions = new Set();
      packageVersions.set(resolved.name, versions);
    }
    versions.add(resolved.version);
  }

  return packageVersions;
}

function findExcessiveDuplicates(packageVersions: Map<string, Set<string>>): DuplicationInfo[] {
  const violations: DuplicationInfo[] = [];

  for (const [packageName, versions] of packageVersions) {
    if (versions.size > MAX_ALLOWED_DUPLICATES) {
      violations.push({
        packageName,
        versions: [...versions].sort(),
      });
    }
  }

  return violations.sort((a, b) => b.versions.length - a.versions.length);
}

async function main() {
  const lockfilePath = path.resolve(__dirname, '..', 'yarn.lock');
  const content = await fs.readFile(lockfilePath, 'utf-8');

  const packageVersions = countResolvedVersions(content);
  const violations = findExcessiveDuplicates(packageVersions);

  // Always print a summary
  const totalPackages = packageVersions.size;
  const totalVersions = [...packageVersions.values()].reduce((sum, v) => sum + v.size, 0);
  const duplicatedPackages = [...packageVersions.values()].filter((v) => v.size > 1).length;

  process.stderr.write(`[sdk-duplication-check] Scanned ${totalPackages} packages, ${totalVersions} total resolutions, ${duplicatedPackages} with >1 version\n`);

  if (violations.length === 0) {
    process.stderr.write(`[sdk-duplication-check] ✅ No package exceeds ${MAX_ALLOWED_DUPLICATES} resolved versions\n`);
    return;
  }

  process.stderr.write(`\n[sdk-duplication-check] ❌ ${violations.length} package(s) exceed the maximum of ${MAX_ALLOWED_DUPLICATES} resolved versions:\n\n`);

  for (const { packageName, versions } of violations) {
    process.stderr.write(`  ${packageName}: ${versions.length} versions\n`);
    for (const v of versions) {
      process.stderr.write(`    - ${v}\n`);
    }
  }

  console.error('To fix: run \'yarn dedupe "@aws-sdk/*" "@smithy/*"\' and verify the result.\n');
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(`[sdk-duplication-check] Fatal error: ${e.message}\n`);
  process.exitCode = 1;
});
