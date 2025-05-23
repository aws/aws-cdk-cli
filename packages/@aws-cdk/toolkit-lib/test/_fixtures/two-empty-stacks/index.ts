import * as core from 'aws-cdk-lib/core';

export default async (props: { outdir: string; context: any }) => {
  const app = new core.App({ autoSynth: false, ...props });
  new core.Stack(app, 'Stack1');
  new core.Stack(app, 'Stack2');

  return app.synth();
};
