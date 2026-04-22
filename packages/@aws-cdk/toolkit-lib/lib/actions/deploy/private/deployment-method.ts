import type { ChangeSetDeployment, DeploymentMethod } from '..';

export const DEFAULT_DEPLOY_CHANGE_SET_NAME = 'cdk-deploy-change-set';

/**
 * Execute a previously created change set.
 * This is an internal deployment method used by the two-phase deploy flow.
 */
export interface ExecuteChangeSetDeployment {
  readonly method: 'execute-change-set';
  readonly changeSetName: string;
}

/**
 * A change set deployment that will execute.
 */
export type ExecutingChangeSetDeployment = ChangeSetDeployment & { execute: true };

/**
 * A change set deployment that will not execute.
 */
export type NonExecutingChangeSetDeployment = ChangeSetDeployment & { execute: false };

/**
 * Returns true if the deployment method is a change-set deployment.
 */
export function isChangeSetDeployment(method?: DeploymentMethod): method is ChangeSetDeployment {
  return method?.method === 'change-set';
}

/**
 * Returns true if the deployment method is a change-set deployment that will execute.
 */
export function isExecutingChangeSetDeployment(method?: DeploymentMethod): method is ExecutingChangeSetDeployment {
  return isChangeSetDeployment(method) && (method.execute ?? true);
}

/**
 * Returns true if the deployment method is a change-set deployment that will not execute.
 */
export function isNonExecutingChangeSetDeployment(method?: DeploymentMethod): method is NonExecutingChangeSetDeployment {
  return isChangeSetDeployment(method) && (method.execute === false);
}

/**
 * Create an ExecuteChangeSetDeployment from a ChangeSetDeployment.
 */
export function toExecuteChangeSetDeployment(method: ChangeSetDeployment): ExecuteChangeSetDeployment {
  return {
    method: 'execute-change-set',
    changeSetName: method.changeSetName ?? DEFAULT_DEPLOY_CHANGE_SET_NAME,
  };
}
