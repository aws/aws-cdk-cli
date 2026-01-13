import type { MissingContext } from '@aws-cdk/cloud-assembly-schema';
import { ToolkitError } from '../../../toolkit/toolkit-error';

/**
 * Temporarily overwrite the `process.env` with a new `env`
 *
 * We make the environment immutable in case there are accidental
 * concurrent accesses.
 */
export function temporarilyWriteEnv(env: Record<string, string>) {
  const oldEnv = process.env;

  process.env = detectSynthvarConflicts({
    ...process.env,
    ...env,
  });

  return {
    [Symbol.dispose]() {
      process.env = oldEnv;
    },
  };
}

/**
 * Return an environment-like object that throws if certain keys are set
 *
 * We only throw on specific environment variables to catch the case of
 * concurrent synths. We can't do all variables because there are some
 * routines somewhere that modify things like `JSII_DEPRECATED` globally.
 */
function detectSynthvarConflicts<A extends object>(obj: A) {
  return new Proxy(obj, {
    get(target, prop) {
      return (target as any)[prop];
    },
    set(target, prop, value) {
      if (['CDK_CONTEXT', 'CDK_OUTDIR'].includes(String(prop))) {
        throw new ToolkitError('process.env is temporarily immutable. Set \'clobberEnv: false\' if you want to run multiple \'fromAssemblyBuilder\' synths concurrently');
      }
      (target as any)[prop] = value;
      return true;
    },
  });
}

/**
 * Return all keys of missing context items
 */
export function missingContextKeys(missing?: MissingContext[]): Set<string> {
  return new Set((missing || []).map((m) => m.key));
}
