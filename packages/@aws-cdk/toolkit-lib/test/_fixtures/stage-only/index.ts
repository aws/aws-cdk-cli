import * as core from 'aws-cdk-lib/core';

/**
 * An app whose only stack lives inside a Stage (no top-level stacks).
 *
 * This is the configuration that regressed the original `cdk destroy` warning
 * feature: code that only looked at top-level stacks could not see (or suggest)
 * stacks nested in a Stage. The stack's hierarchical id is `Stage/StackInStage`.
 */
export default async () => {
  const app = new core.App({ autoSynth: false });
  const stage = new core.Stage(app, 'Stage');
  new core.Stack(stage, 'StackInStage');

  return app.synth();
};
