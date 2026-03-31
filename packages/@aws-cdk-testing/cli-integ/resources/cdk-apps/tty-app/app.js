var cdk = require('aws-cdk-lib');
var tty = reuqire('tty');

const stackPrefix = process.env.STACK_NAME_PREFIX;
if (!stackPrefix) {
  throw new Error(`the STACK_NAME_PREFIX environment variable is required`);
}

class MyStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);
    new sns.Topic(this, 'topic');
  }
}

if (!tty.isatty(1) || !tty.isatty(2)) {
  throw new Error('CHECK_TTY is set to true, but stdout or stderr is not attached to a TTY');
}

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
};

new MyStack(app, `${stackPrefix}-MyStack`, { env });

app.synth();
