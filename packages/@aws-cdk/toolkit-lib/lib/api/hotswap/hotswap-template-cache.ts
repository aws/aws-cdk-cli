import * as path from 'path';
import * as fs from 'fs-extra';
import type { NestedStackTemplates, RootTemplateWithNestedStacks, Template } from '../cloudformation';

const CACHE_DIR = '.hotswap-cache';

/**
 * Hotswap state we persist to disk.
 * Cache deployed templates and physical names - information CFN would have provided.
 * The generatedTemplate is always read fresh from the cloud assembly.
 */
interface CachedNestedStack {
  readonly physicalName: string | undefined;
  readonly deployedTemplate: Template;
  readonly nestedStacks: { [logicalId: string]: CachedNestedStack };
}

interface CachedHotswapState {
  readonly deployedRootTemplate: Template;
  readonly nestedStacks: { [logicalId: string]: CachedNestedStack };
}

function cachePath(assemblyDir: string, stackName: string): string {
  return path.join(assemblyDir, CACHE_DIR, `${stackName}.json`);
}

/**
 * Check if a hotswap cache exists for the given stack.
 */
export function existingHotswapCache(
  assemblyDir: string,
  stackName: string,
): boolean {
  return fs.pathExistsSync(cachePath(assemblyDir, stackName));
}

/**
 * Read the cached hotswap state and hydrate it into a full
 * RootTemplateWithNestedStacks by reading fresh generatedTemplates from disk.
 * Returns undefined if no cache exists.
 */
export async function readHotswapTemplateCache(
  assemblyDir: string,
  stackName: string,
  newRootTemplate: Template,
): Promise<RootTemplateWithNestedStacks | undefined> {
  const cachedPath = cachePath(assemblyDir, stackName);
  if (existingHotswapCache(assemblyDir, stackName)) {
    const cached = await fs.readJson(cachedPath);

    return {
      deployedRootTemplate: cached.deployedRootTemplate,
      nestedStacks: hydrateNestedStacks(assemblyDir, newRootTemplate, cached.nestedStacks),
    };
  } else {
    return undefined;
  }
}

/**
 * Cache the current hotswap state after a successful deployment.
 * The synthesized templates become the new "deployed" baseline.
 */
export async function writeHotswapTemplateCache(
  assemblyDir: string,
  stackName: string,
  rootTemplate: Template,
  nestedStacks: { [logicalId: string]: NestedStackTemplates },
): Promise<void> {
  const state: CachedHotswapState = {
    deployedRootTemplate: rootTemplate,
    nestedStacks: toCachedNestedStacks(nestedStacks),
  };
  const cachedPath = cachePath(assemblyDir, stackName);
  await fs.ensureDir(path.dirname(cachedPath));
  await fs.writeJson(cachedPath, state, { spaces: 2 });
}

/**
 * Invalidate the hotswap cache for a stack (e.g. after a full CloudFormation deploy).
 */
export async function invalidateHotswapTemplateCache(assemblyDir: string, stackName: string): Promise<void> {
  await fs.remove(cachePath(assemblyDir, stackName));
}

/**
 * Convert NestedStackTemplates to the minimal cached form.
 * After a successful hotswap, generatedTemplate is considered the deployed state.
 */
function toCachedNestedStacks(
  nestedStacks: { [logicalId: string]: NestedStackTemplates },
): { [logicalId: string]: CachedNestedStack } {
  const result: { [logicalId: string]: CachedNestedStack } = {};
  for (const [logicalId, ns] of Object.entries(nestedStacks)) {
    result[logicalId] = {
      physicalName: ns.physicalName,
      deployedTemplate: ns.generatedTemplate,
      nestedStacks: toCachedNestedStacks(ns.nestedStackTemplates),
    };
  }
  return result;
}

/**
 * Hydrate cached nested stacks into full NestedStackTemplates by reading
 * the freshly synthesized generatedTemplate from the cloud assembly on disk.
 *
 * Only nested stacks present in the cache are hydrated. New nested stacks
 * (not in cache) are left out so the root-level diff sees them as resource
 * additions and routes them through the normal non-hotswappable path.
 */
function hydrateNestedStacks(
  assemblyDir: string,
  parentTemplate: Template,
  cachedNestedStacks: { [logicalId: string]: CachedNestedStack },
): { [logicalId: string]: NestedStackTemplates } {
  const result: { [logicalId: string]: NestedStackTemplates } = {};

  for (const [logicalId, resource] of Object.entries(parentTemplate.Resources ?? {})) {
    const res = resource as any;
    const assetPath = res?.Metadata?.['aws:asset:path'];
    // we only care about surfacing nested stacks, skip other resource types
    if (res?.Type !== 'AWS::CloudFormation::Stack' || !assetPath) {
      continue;
    }

    const cached = cachedNestedStacks[logicalId];
    if (!cached) {
      // New nested stack — skip so it's treated as a resource addition
      continue;
    }

    const generatedTemplate: Template = JSON.parse(
      fs.readFileSync(path.join(assemblyDir, assetPath), 'utf-8'),
    );

    result[logicalId] = {
      physicalName: cached.physicalName,
      deployedTemplate: cached.deployedTemplate,
      generatedTemplate,
      nestedStackTemplates: hydrateNestedStacks(assemblyDir, generatedTemplate, cached.nestedStacks ?? {}),
    };
  }

  return result;
}
