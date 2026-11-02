const cdk = require('aws-cdk-lib/core');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

// WAFv2 WebACL whose action flips between Allow and Block via WAF_ACTION. CloudFormation
// changesets do not detect exchanging one empty-object action for another, so this exercises
// the diff keeping the template-detected change. See aws/aws-cdk-cli#1922.
class WafWebAclStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    const action = process.env.WAF_ACTION || 'Allow';
    new cdk.CfnResource(this, 'WebAcl', {
      type: 'AWS::WAFv2::WebACL',
      properties: {
        Scope: 'REGIONAL',
        DefaultAction: { [action]: {} },
        VisibilityConfig: {
          MetricName: 'waf-diff-test',
          CloudWatchMetricsEnabled: false,
          SampledRequestsEnabled: false,
        },
      },
    });
  }
}

const app = new cdk.App();
new WafWebAclStack(app, `${stackPrefix}-waf-web-acl`);

app.synth();
