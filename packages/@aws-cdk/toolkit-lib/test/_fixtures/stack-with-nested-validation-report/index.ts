import * as fs from 'node:fs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as core from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

/**
 * A plugin that reports an error violation for every bucket in every template.
 */
class NoPublicBucketsPlugin implements core.IPolicyValidationPlugin {
  public readonly name = 'TestPlugin';
  public readonly version = '1.0.0';

  public validate(context: core.IPolicyValidationContext): core.PolicyValidationPluginReport {
    const violatingResources = context.stackTemplates.flatMap((stackTemplate) => {
      const template = JSON.parse(fs.readFileSync(stackTemplate.templatePath, 'utf-8'));
      return Object.entries(template.Resources ?? {})
        .filter(([_, resource]: [string, any]) => resource.Type === 'AWS::S3::Bucket')
        .map(([logicalId]) => ({
          resourceLogicalId: logicalId,
          templatePath: stackTemplate.templatePath,
          locations: [`/Resources/${logicalId}`],
        }));
    });

    return {
      success: violatingResources.length === 0,
      violations: violatingResources.length === 0 ? [] : [{
        ruleName: 'no-public-buckets',
        description: 'S3 Buckets must not be publicly accessible',
        fix: 'Set PublicAccessBlockConfiguration on the bucket',
        severity: 'error',
        violatingResources,
      }],
    };
  }
}

/**
 * An app with a stack nested inside a plain grouping construct (not a Stage).
 *
 * The stack's `hierarchicalId` is `myGroup/MyStack`, so it has more than one path
 * segment even though it lives in the app's top-level cloud assembly. Used to
 * exercise filtering of policy validation violations by selected stack.
 *
 * @see https://github.com/aws/aws-cdk-cli/issues/1974
 */
export default async () => {
  const app = new core.App({ autoSynth: false });
  core.Validations.of(app).addPlugins(new NoPublicBucketsPlugin());

  const group = new Construct(app, 'myGroup');
  const stack = new core.Stack(group, 'MyStack', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
  });
  new s3.Bucket(stack, 'MyBucket');

  return app.synth();
};
