import type { Investigations } from '../../actions/diagnose';

/**
 * Investigations run when `cdk deploy` fails.
 *
 * CloudTrail is off because, right after a deployment, its events are often not yet
 * delivered and cannot be tied to the deployment; hook details are off because the
 * deployment's activity stream already shows them live.
 */
export const DEPLOY_INVESTIGATIONS: Required<Investigations> = {
  cloudTrail: false,
  customResources: true,
  ecs: true,
  hooks: false,
};

/**
 * Investigations run by `cdk diagnose`.
 */
export const DIAGNOSE_INVESTIGATIONS: Required<Investigations> = {
  cloudTrail: true,
  customResources: true,
  ecs: true,
  hooks: true,
};

/**
 * Apply user-provided investigation settings on top of an action's defaults.
 */
export function resolveInvestigations(defaults: Required<Investigations>, overrides?: Investigations): Required<Investigations> {
  return {
    cloudTrail: overrides?.cloudTrail ?? defaults.cloudTrail,
    customResources: overrides?.customResources ?? defaults.customResources,
    ecs: overrides?.ecs ?? defaults.ecs,
    hooks: overrides?.hooks ?? defaults.hooks,
  };
}
