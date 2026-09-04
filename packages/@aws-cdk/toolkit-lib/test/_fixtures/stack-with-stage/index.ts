import * as core from 'aws-cdk-lib/core';

/**
 * An app with a top-level stack plus a stack nested inside a Stage.
 *
 * Hierarchical ids: `TopLevelStack` and `Stage/StackInStage`. Used to exercise
 * destroy/suggestion behavior across both top-level and nested-stage stacks.
 */
export default async () => {
  const app = new core.App({ autoSynth: false });
  new core.Stack(app, 'TopLevelStack');
  const stage = new core.Stage(app, 'Stage');
  new core.Stack(stage, 'StackInStage');

  return app.synth();
};
