import * as iam from 'aws-cdk-lib/aws-iam';
import * as core from 'aws-cdk-lib/core';

export default async (props: { outdir: string; context: any }) => {
  const app = new core.App({ autoSynth: false, ...props });
  const stack = new core.Stack(app, 'Stack1');
  new iam.Role(stack, 'Role', {
    assumedBy: new iam.ArnPrincipal('arn'),
  });
  return app.synth() as any;
};
