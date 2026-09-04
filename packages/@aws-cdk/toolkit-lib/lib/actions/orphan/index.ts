export interface OrphanOptions {
  /**
   * Construct path prefix(es) to orphan, e.g. `MyStack/MyTable`. For a stack
   * inside a Stage the path is stage-qualified, e.g. `MyStage/MyStack/MyTable`.
   *
   * The stack is derived from the path — all paths must reference the same stack.
   */
  readonly constructPaths: string[];

  /**
   * Role to assume in the target environment.
   */
  readonly roleArn?: string;

  /**
   * Toolkit stack name for bootstrap resources.
   */
  readonly toolkitStackName?: string;
}
