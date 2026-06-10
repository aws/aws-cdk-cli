import type { StackDetails } from '@aws-cdk/toolkit-lib';
import { serializeStructure } from '../util';

/**
 * Render the output of `cdk list` for a set of stacks, honoring the output flags.
 *
 * - `--long --show-dependencies`: the full stack details, serialized.
 * - `--show-dependencies`: each stack's id and its dependencies, serialized.
 * - `--long`: each stack's id, name and environment, serialized.
 * - otherwise: the stack ids, one per line.
 *
 * `--json` selects JSON over YAML for the serialized variants (it has no effect
 * on the plain id listing, matching the historical CLI behavior).
 */
export function formatStackList(
  stacks: StackDetails[],
  options: { long?: boolean; json?: boolean; showDeps?: boolean } = {},
): string {
  const json = options.json ?? false;

  if (options.long && options.showDeps) {
    // Only a subset of stack information is printed; in particular metadata
    // (which may be huge) is intentionally excluded.
    const full = stacks.map(stack => ({
      id: stack.id,
      name: stack.name,
      environment: stack.environment,
      dependencies: stack.dependencies,
    }));
    return serializeStructure(full, json);
  }

  if (options.showDeps) {
    const stackDeps = stacks.map(stack => ({
      id: stack.id,
      dependencies: stack.dependencies,
    }));
    return serializeStructure(stackDeps, json);
  }

  if (options.long) {
    const long = stacks.map(stack => ({
      id: stack.id,
      name: stack.name,
      environment: stack.environment,
    }));
    return serializeStructure(long, json);
  }

  // just the stack ids
  return stacks.map(stack => stack.id).join('\n');
}
