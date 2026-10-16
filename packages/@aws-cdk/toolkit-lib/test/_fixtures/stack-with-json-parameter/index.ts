import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as core from 'aws-cdk-lib/core';

/**
 * A string parameter that holds JSON built with an intrinsic, the way `Stack.toJsonString` renders
 * it (and the EKS `KubernetesManifest` and `HelmChart` constructs use it).
 */
export default async () => {
  const app = new core.App({ autoSynth: false });
  const stack = new core.Stack(app, 'Stack1', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
  });
  new ssm.StringParameter(stack, 'Param', {
    stringValue: stack.toJsonString({ stack: core.Aws.STACK_NAME, a: '1', b: '2' }),
  });
  return app.synth();
};
