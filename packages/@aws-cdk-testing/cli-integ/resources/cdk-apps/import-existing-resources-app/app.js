const cdk = require('aws-cdk-lib/core');
const iam = require('aws-cdk-lib/aws-iam');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error('the STACK_NAME_PREFIX environment variable is required');
}

class ImportExistingResourcesStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const retain = process.env.REMOVAL_POLICY === 'retain';

    const role = new iam.Role(this, 'MyRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: `${stackPrefix}-import-role`,
    });
    role.applyRemovalPolicy(retain ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY);
  }
}

const app = new cdk.App();
new ImportExistingResourcesStack(app, `${stackPrefix}-import-existing`);

app.synth();
