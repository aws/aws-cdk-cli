const cdk = require('aws-cdk-lib');
const sqs = require('aws-cdk-lib/aws-sqs');

class BasicStack extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);
    new sqs.Queue(this, props.queueName);
  }
}

const stackPrefix = process.env.STACK_NAME_PREFIX;
const app = new cdk.App();

new BasicStack(app, `${stackPrefix}-basic`, {
    queueName: process.env.BASIC_QUEUE_LOGICAL_ID ?? 'BasicQueue',
});

app.synth();